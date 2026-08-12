import 'dotenv/config'
import { setTimeout as delay } from 'node:timers/promises'
import { isDemoModeEnabled } from './lib/server/demo'
import { maybeRunCleanupRulesFromWorker } from './lib/server/cleanup-rules'
import { startBackgroundAction, waitForBackgroundActions } from './lib/server/background-actions'
import { runMigrations } from './lib/server/db'
import {
  dispatchReadyImapOperations,
  recoverInterruptedImapJobs,
  waitForImapOperations
} from './lib/server/imap-worker'
import { addDirtyMailbox, closeImapConnections, syncWatchers } from './lib/server/imap-connections'
import { closePublicImapProxy, startPublicImapProxy } from './lib/server/imap-public-proxy'
import { getImapConfigs } from './lib/server/config'
import { maybeClassifyPendingMailFromWorker } from './lib/server/mail-importance'
import { dispatchPendingEmailReadNotifications } from './lib/server/email-read-notifications'
import {
  backfillMailAuthenticationFromWorker,
  backfillOpenPgpFromWorker,
  getMailboxSyncPollMs,
  repairThreadKeys,
  purgeOrphanedMessages,
  runMailboxSyncOnce,
  touchSyncWorkerHeartbeat
} from './lib/server/mail'
import {
  dispatchReadySmtpOperations,
  recoverInterruptedSmtpJobs,
  waitForSmtpOperations
} from './lib/server/smtp-worker'
import { cleanupStalePublicAttachments } from './lib/server/public-attachments'
import { cleanupRostackState } from './lib/server/rostack'

const WORKER_TICK_MS = 1_000
const HEARTBEAT_MS = 30_000

let stopping = false
let lastHeartbeatAt = 0
let lastSyncAttemptAt = 0
let lastBackfillAt = 0
let lastAttachmentCleanupAt = 0
let lastRostackCleanupAt = 0
let syncRequested = false
const dirtyMailboxes = new Map<string, Set<string>>()
const workerActions = new Map<string, Promise<void>>()

function startWorkerAction(name: string, action: () => Promise<unknown>) {
  if (stopping) return
  startBackgroundAction(workerActions, name, action, (error) => {
    console.error(`[worker] ${name} failed:`, error)
  })
}

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

  lastSyncAttemptAt = Date.now()
  const requestedMailboxes = syncRequested
    ? new Map([...dirtyMailboxes].map(([id, mailboxes]) => [id, new Set(mailboxes)]))
    : undefined
  syncRequested = false
  dirtyMailboxes.clear()
  await runMailboxSyncOnce({ mailboxes: requestedMailboxes })
}

function maybeRunBackfills() {
  if (Date.now() - lastBackfillAt < 60_000) return
  lastBackfillAt = Date.now()
  startWorkerAction('mail authentication backfill', backfillMailAuthenticationFromWorker)
  startWorkerAction('OpenPGP backfill', backfillOpenPgpFromWorker)
}

async function maybeCleanupPublicAttachments() {
  if (Date.now() - lastAttachmentCleanupAt < 60 * 60 * 1000) return
  lastAttachmentCleanupAt = Date.now()
  await cleanupStalePublicAttachments()
  await purgeOrphanedMessages()
}

async function maybeCleanupRostackState() {
  if (Date.now() - lastRostackCleanupAt < 60 * 60 * 1000) return
  lastRostackCleanupAt = Date.now()
  await cleanupRostackState()
}

function tick() {
  if (stopping) return
  startWorkerAction('heartbeat', heartbeat)
  startWorkerAction('IMAP operation dispatch', dispatchReadyImapOperations)
  startWorkerAction('SMTP operation dispatch', dispatchReadySmtpOperations)
  startWorkerAction('email read notification dispatch', dispatchPendingEmailReadNotifications)
  startWorkerAction('cleanup rules', maybeRunCleanupRulesFromWorker)
  startWorkerAction('mailbox sync', maybeRunSync)
  startWorkerAction('importance classification', maybeClassifyPendingMailFromWorker)
  startWorkerAction('public attachment cleanup', maybeCleanupPublicAttachments)
  startWorkerAction('rostack state cleanup', maybeCleanupRostackState)
  maybeRunBackfills()
}

async function waitForWorkerActions() {
  await waitForBackgroundActions(workerActions)
  await Promise.all([waitForImapOperations(), waitForSmtpOperations()])
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
    tick()
    await delay(WORKER_TICK_MS)
  }
  await waitForWorkerActions()
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
