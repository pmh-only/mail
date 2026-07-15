import { ImapFlow } from 'imapflow'
import type { ImapConfig } from './config'

const CONNECT_TIMEOUT_MS = 20_000
const MAX_IDLE_TIME_MS = 25 * 60_000
const MAX_RECONNECT_MS = 5 * 60_000
export const MAX_CONNECTIONS_PER_ACCOUNT = 2

type Entry = {
  fingerprint: string
  config: ImapConfig
  worker: ImapFlow | null
  workerConnecting: Promise<ImapFlow> | null
  watcher: ImapFlow | null
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  retired: boolean
}

const entries = new Map<string, Entry>()
let wakeSync: ((configId: string, mailbox: string) => void) | null = null
let stopped = false

function fingerprint(config: ImapConfig) {
  return [
    config.host,
    config.port,
    config.secure,
    config.user,
    config.password,
    config.mailbox
  ].join('\0')
}

export function reconnectDelayMs(attempt: number) {
  return Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** Math.min(attempt, 8))
}

export function addDirtyMailbox(
  dirty: Map<string, Set<string>>,
  configId: string,
  mailbox: string
) {
  const mailboxes = dirty.get(configId) ?? new Set<string>()
  mailboxes.add(mailbox)
  dirty.set(configId, mailboxes)
}

function createClient(config: ImapConfig, watcher = false) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    qresync: true,
    maxIdleTime: watcher ? MAX_IDLE_TIME_MS : undefined,
    missingIdleCommand: watcher ? 'NOOP' : undefined
  })
}

function closeClient(client: ImapFlow | null) {
  if (!client) return
  try {
    client.close()
  } catch {
    // already closed
  }
}

function createEntry(config: ImapConfig): Entry {
  return {
    fingerprint: fingerprint(config),
    config,
    worker: null,
    workerConnecting: null,
    watcher: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    retired: false
  }
}

function entryFor(config: ImapConfig) {
  const current = entries.get(config.id)
  const nextFingerprint = fingerprint(config)
  if (current?.fingerprint === nextFingerprint) return current

  if (current) {
    current.retired = true
    closeClient(current.worker)
    closeClient(current.watcher)
    if (current.reconnectTimer) clearTimeout(current.reconnectTimer)
  }
  const next = createEntry(config)
  entries.set(config.id, next)
  return next
}

export async function getWorkerConnection(config: ImapConfig) {
  const entry = entryFor(config)
  if (entry.worker?.usable) return entry.worker
  if (entry.workerConnecting) return entry.workerConnecting
  if (entry.worker) {
    closeClient(entry.worker)
    entry.worker = null
  }

  entry.workerConnecting = (async () => {
    const client = createClient(config)
    try {
      await client.connect()
      if (entry.retired || stopped) {
        closeClient(client)
        throw new Error('IMAP connection entry was retired')
      }
      entry.worker = client
      return client
    } catch (error) {
      closeClient(client)
      throw error
    } finally {
      entry.workerConnecting = null
    }
  })()
  return entry.workerConnecting
}

export function invalidateWorkerConnection(configId: string, client: ImapFlow) {
  const entry = entries.get(configId)
  if (entry?.worker !== client) return
  closeClient(client)
  entry.worker = null
}

export function wakeMailboxSync(configId: string, mailbox: string) {
  wakeSync?.(configId, mailbox)
}

async function connectWatcher(entry: Entry) {
  if (stopped || entry.watcher) return
  const client = createClient(entry.config, true)
  entry.watcher = client

  const changed = () => wakeSync?.(entry.config.id, entry.config.mailbox)
  client.on('exists', changed)
  client.on('expunge', changed)
  client.on('flags', changed)
  client.on('error', (error) => console.error(`[imap] ${entry.config.name} watcher error`, error))
  client.on('close', () => {
    if (entry.watcher === client) entry.watcher = null
    scheduleWatcherReconnect(entry)
  })

  try {
    await client.connect()
    await client.mailboxOpen(entry.config.mailbox)
    entry.reconnectAttempt = 0
  } catch (error) {
    console.error(`[imap] ${entry.config.name} watcher connect failed`, error)
    closeClient(client)
    if (entry.watcher === client) entry.watcher = null
    scheduleWatcherReconnect(entry)
  }
}

function scheduleWatcherReconnect(entry: Entry) {
  if (stopped || entry.retired || entry.reconnectTimer) return
  const delay = reconnectDelayMs(entry.reconnectAttempt++)
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null
    void connectWatcher(entry)
  }, delay)
}

export async function syncWatchers(
  configs: ImapConfig[],
  onWake: (configId: string, mailbox: string) => void
) {
  stopped = false
  wakeSync = onWake
  const activeIds = new Set(configs.map((config) => config.id))

  for (const [id, entry] of entries) {
    if (activeIds.has(id)) continue
    entry.retired = true
    closeClient(entry.worker)
    closeClient(entry.watcher)
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
    entries.delete(id)
  }

  await Promise.all(configs.map((config) => connectWatcher(entryFor(config))))
}

export async function closeImapConnections() {
  stopped = true
  wakeSync = null
  const clients: ImapFlow[] = []
  for (const entry of entries.values()) {
    entry.retired = true
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
    if (entry.watcher) clients.push(entry.watcher)
    if (entry.worker) clients.push(entry.worker)
  }
  entries.clear()
  await Promise.allSettled(
    clients.map(async (client) => {
      try {
        await client.logout()
      } catch {
        closeClient(client)
      }
    })
  )
}
