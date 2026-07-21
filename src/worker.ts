import 'dotenv/config'
import { setTimeout as delay } from 'node:timers/promises'
import { isDemoModeEnabled } from './lib/server/demo'
import { maybeRunCleanupRulesFromWorker } from './lib/server/cleanup-rules'
import { runMigrations } from './lib/server/db'
import { drainImapQueue, recoverInterruptedImapJobs } from './lib/server/imap-worker'
import { addDirtyMailbox, closeImapConnections, syncWatchers } from './lib/server/imap-connections'
import { closePublicImapProxy, startPublicImapProxy } from './lib/server/imap-public-proxy'
import { getImapConfigs } from './lib/server/config'
import { maybeClassifyPendingMailFromWorker } from './lib/server/mail-importance'
import {
  backfillMailAuthenticationFromWorker,
  backfillOpenPgpFromWorker,
  getMailboxSyncPollMs,
  repairThreadKeys,
  runMailboxSyncOnce,
  touchSyncWorkerHeartbeat
} from './lib/server/mail'
import {
  drainSmtpQueue,
  hasUnfinishedSmtpJobs,
  recoverInterruptedSmtpJobs
} from './lib/server/smtp-worker'

const WORKER_TICK_MS = 1_000
const HEARTBEAT_MS = 30_000

let tickInFlight = false
let stopping = false
let lastHeartbeatAt = 0
let lastSyncAttemptAt = 0
let lastBackfillAt = 0
let syncRequested = false
const dirtyMailboxes = new Map<string, Set<string>>()

function requestMailboxSync(configId: string, mailbox: string) {
  addDirtyMailbox(dirtyMailboxes, configId, mailbox)
  syncRequested = true
}

async function heartbeat() {
  if (Date.now() - lastHeartbeatAt < HEARTBEAT_MS) return
  await touchSyncWorkerHeartbeat()
  await syncWatchers(await getImapConfigs(), requestMailboxSync)
  lastHeartbeatAt = Date.now()
}

async function maybeRunSync() {
  const pollMs = await getMailboxSyncPollMs()
  if (pollMs === null) return
  if (!syncRequested && Date.now() - lastSyncAttemptAt < pollMs) return

  await drainImapQueue()
  if (await hasUnfinishedSmtpJobs()) return

  lastSyncAttemptAt = Date.now()
  const requestedMailboxes = syncRequested
    ? new Map([...dirtyMailboxes].map(([id, mailboxes]) => [id, new Set(mailboxes)]))
    : undefined
  syncRequested = false
  dirtyMailboxes.clear()
  await runMailboxSyncOnce({
    mailboxes: requestedMailboxes,
    beforeMailbox: async () => {
      await drainImapQueue()
    }
  })
}

async function tick() {
  if (tickInFlight || stopping) return
  tickInFlight = true

  try {
    await heartbeat()
    await drainImapQueue()
    await drainSmtpQueue()
    await maybeRunCleanupRulesFromWorker()

    // The sync clock is paused while SMTP jobs are pending/running/retrying.
    if (await hasUnfinishedSmtpJobs()) return

    await maybeRunSync()

    if (Date.now() - lastBackfillAt >= 60_000) {
      lastBackfillAt = Date.now()
      await backfillMailAuthenticationFromWorker()
      await backfillOpenPgpFromWorker()
    }
    void maybeClassifyPendingMailFromWorker()
  } catch (error) {
    console.error('[worker] tick failed:', error)
  } finally {
    tickInFlight = false
  }
}

async function main() {
  if (isDemoModeEnabled()) {
    console.log('[worker] demo mode enabled; worker is not required')
    return
  }

  await runMigrations()
  await repairThreadKeys()
  await startPublicImapProxy()
  await recoverInterruptedImapJobs()
  await recoverInterruptedSmtpJobs()
  await syncWatchers(await getImapConfigs(), requestMailboxSync)

  console.log('[worker] started')
  while (!stopping) {
    await tick()
    await delay(WORKER_TICK_MS)
  }
  await closePublicImapProxy()
  await closeImapConnections()
}

function stop() {
  stopping = true
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

main().catch((error) => {
  console.error('[worker] fatal:', error)
  process.exit(1)
})
