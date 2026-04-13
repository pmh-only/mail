import { desc, eq, inArray, sql } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { db, client as sqliteClient } from '$lib/server/db'
import { mailboxSync, mailMessage, mailMessageMailbox } from '$lib/server/db/schema'
import { enqueueMarkRead, enqueueMoveMessage, registerImapConfig } from '$lib/server/imap-queue'
import { getImapConfig, type ImapConfig } from '$lib/server/config'
import { withRetry } from '$lib/server/retry'

const IMAP_CONNECT_TIMEOUT_MS = 20_000

async function connectImap(config: ImapConfig, label: string): Promise<ImapFlow> {
  return withRetry(
    async () => {
      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        logger: false,
        connectionTimeout: IMAP_CONNECT_TIMEOUT_MS
      })
      try {
        await client.connect()
        return client
      } catch (err) {
        try { client.close() } catch { /* ignore */ }
        throw err
      }
    },
    { label, maxAttempts: 3, baseDelayMs: 2000 }
  )
}

// Joined row returned by list/get queries
export type MailRow = {
  id: number // mail_message_mailbox.id
  messageId: string
  mailbox: string
  uid: number
  flags: string
  subject: string
  from: string
  to: string
  preview: string
  textContent: string
  htmlContent: string | null
  receivedAt: Date | null
}

export type SyncResult = {
  mailbox: string
  configured: boolean
  skipped: boolean
  syncing?: boolean
  fetchedCount: number
  storedCount: number
  lastSyncedAt: string | null
  lastError: string | null
  reason?: string
}

// Yield control back to the Node.js event loop so HTTP requests can be served
// between sync chunks. better-sqlite3 is synchronous and blocks the event loop,
// so without explicit yields the server becomes unresponsive during sync.
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

let activeSync: Promise<void> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null

type ActiveSyncProgress = {
  mailbox: string
  stored: number
  total: number
}
let activeSyncProgress: ActiveSyncProgress | null = null

registerImapConfig(async () => {
  const config = await getImapConfig()
  if ('missing' in config) return null
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    password: config.password
  }
})

function summarizeAddresses(input: unknown) {
  if (!input || typeof input !== 'object' || !('value' in input)) return ''
  const addresses = (input as { value?: Array<{ name?: string; address?: string }> }).value ?? []
  return addresses
    .map((entry) => entry.name || entry.address || '')
    .filter(Boolean)
    .join(', ')
}

function createPreview(text: string) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '') // images with src
    .replace(/\[.*?\]\(.*?\)/g, '') // links
    .replace(/\[https?:\/\/[^\]]*\]/g, '') // bare [url] blocks
    .replace(/\[image:[^\]]*\]/gi, '') // [image: ...] alt text
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2') // bold/italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/^\s*[-*+>]\s+/gm, '') // list items, blockquotes
    .replace(/^\s*[-_*]{3,}\s*$/gm, '') // horizontal rules
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function extractErrorParts(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return []
  seen.add(error)

  if (typeof error === 'string') {
    return error.trim() ? [error.trim()] : []
  }

  if (!(error instanceof Error) && typeof error !== 'object') {
    return []
  }

  const record = error as Record<string, unknown>
  const parts: string[] = []

  if (error instanceof Error && error.message.trim()) {
    parts.push(error.message.trim())
  }

  for (const key of ['responseText', 'response', 'serverResponse', 'stderr', 'stdout']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim())
    }
  }

  if (typeof record.command === 'string' && record.command.trim()) {
    parts.push(`Command: ${record.command.trim()}`)
  }

  if (typeof record.code === 'string' && record.code.trim()) {
    parts.push(`Code: ${record.code.trim()}`)
  }

  if ('cause' in record) {
    parts.push(...extractErrorParts(record.cause, seen))
  }

  return dedupe(parts)
}

function getErrorMessage(error: unknown) {
  const parts = extractErrorParts(error)
  const meaningfulParts =
    parts.length > 1 ? parts.filter((part) => !/^Command failed\b/i.test(part)) : parts

  return meaningfulParts[0] ?? parts[0] ?? 'Unknown IMAP sync error'
}

async function readSyncState(mailbox: string) {
  const [state] = await db
    .select()
    .from(mailboxSync)
    .where(eq(mailboxSync.mailbox, mailbox))
    .limit(1)
  return state
}

async function saveSyncState(mailbox: string, values: Partial<typeof mailboxSync.$inferInsert>) {
  await db
    .insert(mailboxSync)
    .values({ mailbox, ...values })
    .onConflictDoUpdate({
      target: mailboxSync.mailbox,
      set: values
    })
}

// Store or skip message content (skipped if message_id already exists)
async function storeMessageContent(
  effectiveMessageId: string,
  message: Awaited<ReturnType<typeof simpleParser>>,
  internalDate?: Date
) {
  const receivedAt = message.date ?? internalDate ?? null
  const textContent = message.text?.trim() ?? ''
  const htmlContent = typeof message.html === 'string' ? message.html : null

  await db
    .insert(mailMessage)
    .values({
      messageId: effectiveMessageId,
      subject: message.subject?.trim() ?? '(no subject)',
      from: summarizeAddresses(message.from),
      to: summarizeAddresses(message.to),
      preview: createPreview(textContent),
      textContent,
      htmlContent,
      receivedAt
    })
    .onConflictDoNothing()
}

// Insert or update the per-mailbox entry for a message
async function storeMailboxEntry(
  effectiveMessageId: string,
  mailbox: string,
  uid: number,
  flags: string[]
) {
  await db
    .insert(mailMessageMailbox)
    .values({
      messageId: effectiveMessageId,
      mailbox,
      uid,
      flags: JSON.stringify(flags),
      syncedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
      set: {
        messageId: effectiveMessageId,
        flags: JSON.stringify(flags),
        syncedAt: new Date()
      }
    })
}

async function syncOneMailbox(
  config: ImapConfig,
  mailboxPath: string,
  pollMs: number
): Promise<void> {
  const state = await readSyncState(mailboxPath)
  const lastSyncedAt = state?.lastSyncedAt?.getTime() ?? 0

  if (lastSyncedAt && Date.now() - lastSyncedAt < pollMs) return

  const historyComplete = state?.historyComplete ?? false
  let nextLastUid = state?.lastUid ?? 0
  let fetchedCount = 0
  let storedCount = 0

  const t0 = Date.now()
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

  activeSyncProgress = { mailbox: mailboxPath, stored: 0, total: 0 }
  console.log(
    `[sync] ${mailboxPath}: starting (lastUid=${nextLastUid}, historyComplete=${historyComplete})`
  )
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `${mailboxPath} sync`)
    console.log(`[sync] ${mailboxPath}: connected (${elapsed()})`)
    const lock = await client.getMailboxLock(mailboxPath)
    try {
      const needsInitialBackfill = !historyComplete && nextLastUid === 0
      const range = needsInitialBackfill ? '1:*' : `${nextLastUid + 1}:*`
      const fetchOptions = needsInitialBackfill ? undefined : { uid: true }

      console.log(
        `[sync] ${mailboxPath}: fetching envelopes range=${range} (${elapsed()})`
      )

      // Phase 1: fetch lightweight envelopes to discover message-ids
      type EnvelopeItem = {
        uid: number
        effectiveMessageId: string
        flags: string[]
        internalDate: Date | undefined
      }
      const envelopeItems: EnvelopeItem[] = []

      for await (const item of client.fetch(
        range,
        { uid: true, envelope: true, flags: true, internalDate: true },
        fetchOptions
      )) {
        if (!item.uid) continue
        const msgId = (item.envelope as { messageId?: string } | undefined)?.messageId?.trim()
        const effectiveMessageId = msgId || `synthetic:${mailboxPath}:${item.uid}`
        const flags = Array.from(item.flags ?? []).map(String)
        const internalDate =
          item.internalDate instanceof Date
            ? item.internalDate
            : typeof item.internalDate === 'string'
              ? new Date(item.internalDate)
              : undefined

        envelopeItems.push({ uid: item.uid, effectiveMessageId, flags, internalDate })
        nextLastUid = Math.max(nextLastUid, item.uid)
        fetchedCount += 1
        if (fetchedCount % 1000 === 0) {
          console.log(`[sync] ${mailboxPath}: envelopes fetched ${fetchedCount}... (${elapsed()})`)
        }
      }

      console.log(
        `[sync] ${mailboxPath}: envelope fetch complete — ${fetchedCount} messages (${elapsed()})`
      )

      if (envelopeItems.length === 0) {
        console.log(`[sync] ${mailboxPath}: no new messages`)
      } else {
        // Phase 2: check which message-ids we already have content for
        console.log(`[sync] ${mailboxPath}: checking cache for ${fetchedCount} message-ids...`)
        const allMessageIds = envelopeItems.map((i) => i.effectiveMessageId)
        const existingIds = new Set(
          (
            await db
              .select({ messageId: mailMessage.messageId })
              .from(mailMessage)
              .where(inArray(mailMessage.messageId, allMessageIds))
          ).map((r) => r.messageId)
        )

        const needsSourceItems = envelopeItems.filter(
          (i) => !existingIds.has(i.effectiveMessageId)
        )
        const cachedItems = envelopeItems.filter((i) => existingIds.has(i.effectiveMessageId))
        const cachedCount = fetchedCount - needsSourceItems.length

        activeSyncProgress = { mailbox: mailboxPath, stored: 0, total: fetchedCount }

        if (needsSourceItems.length === 0) {
          console.log(
            `[sync] ${mailboxPath}: all ${fetchedCount} messages already cached — updating mailbox entries only (${elapsed()})`
          )
        } else {
          console.log(
            `[sync] ${mailboxPath}: ${needsSourceItems.length} new, ${cachedCount} cached — fetching source for new messages (${elapsed()})`
          )
        }

        // Phase 3a: update mailbox entries for already-cached messages
        // Written in chunks with event-loop yields between them so the HTTP
        // server stays responsive. Each chunk runs in a single transaction for
        // speed (one disk sync per chunk instead of one per row).
        if (cachedItems.length > 0) {
          const CHUNK_SIZE = 200
          console.log(`[sync] ${mailboxPath}: updating ${cachedItems.length} cached mailbox entries...`)
          for (let ci = 0; ci < cachedItems.length; ci += CHUNK_SIZE) {
            const chunk = cachedItems.slice(ci, ci + CHUNK_SIZE)
            sqliteClient.transaction(() => {
              for (const item of chunk) {
                db.insert(mailMessageMailbox)
                  .values({
                    messageId: item.effectiveMessageId,
                    mailbox: mailboxPath,
                    uid: item.uid,
                    flags: JSON.stringify(item.flags),
                    syncedAt: new Date()
                  })
                  .onConflictDoUpdate({
                    target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
                    set: {
                      messageId: item.effectiveMessageId,
                      flags: JSON.stringify(item.flags),
                      syncedAt: new Date()
                    }
                  })
                  .run()
              }
            })()
            storedCount += chunk.length
            if (activeSyncProgress) activeSyncProgress.stored = storedCount
            if (storedCount % 500 === 0) {
              console.log(
                `[sync] ${mailboxPath}: updated ${storedCount}/${fetchedCount} entries (${elapsed()})`
              )
            }
            await yieldToEventLoop()
          }
          console.log(
            `[sync] ${mailboxPath}: cached entries updated (${elapsed()})`
          )
        }

        // Phase 3b: fetch source newest-first, in batches so recent mail lands in DB first
        if (needsSourceItems.length > 0) {
          const BATCH_SIZE = 150
          // Sort descending so batches go from highest UID (newest) to lowest (oldest)
          const byNewest = [...needsSourceItems].sort((a, b) => b.uid - a.uid)

          for (let batchStart = 0; batchStart < byNewest.length; batchStart += BATCH_SIZE) {
            const batch = byNewest.slice(batchStart, batchStart + BATCH_SIZE)
            const itemByUid = new Map(batch.map((i) => [i.uid, i]))

            for await (const fetchItem of client.fetch(
              batch.map((i) => i.uid).join(','),
              { uid: true, source: true },
              { uid: true }
            )) {
              if (!fetchItem.uid || !fetchItem.source) continue
              const item = itemByUid.get(fetchItem.uid)
              if (!item) continue
              const parsed = await simpleParser(fetchItem.source)
              await storeMessageContent(item.effectiveMessageId, parsed, item.internalDate)
              await storeMailboxEntry(item.effectiveMessageId, mailboxPath, item.uid, item.flags)
              storedCount += 1
              if (activeSyncProgress) activeSyncProgress.stored = storedCount
              if (storedCount % 100 === 0) {
                console.log(
                  `[sync] ${mailboxPath}: stored ${storedCount}/${fetchedCount} (${elapsed()})`
                )
              }
            }
            // Yield between batches so HTTP requests can be served
            await yieldToEventLoop()
          }
        }
      }
    } finally {
      lock.release()
    }

    activeSyncProgress = null
    console.log(
      `[sync] ${mailboxPath}: done — ${fetchedCount} fetched, ${storedCount} stored (${elapsed()})`
    )
    await saveSyncState(mailboxPath, {
      lastUid: nextLastUid,
      historyComplete: true,
      lastFetchedCount: fetchedCount,
      lastStoredCount: storedCount,
      lastSyncedAt: new Date(),
      lastError: null
    })
  } catch (error) {
    activeSyncProgress = null
    console.error(`[sync] ${mailboxPath}: error after ${elapsed()} — ${getErrorMessage(error)}`)
    await saveSyncState(mailboxPath, {
      lastUid: nextLastUid,
      historyComplete,
      lastFetchedCount: fetchedCount || (state?.lastFetchedCount ?? 0),
      lastStoredCount: storedCount || (state?.lastStoredCount ?? 0),
      lastSyncedAt: new Date(),
      lastError: getErrorMessage(error)
    })
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}

async function runSyncAll(config: ImapConfig): Promise<void> {
  const pollMs = config.pollSeconds * 1000
  let listed: { path: string; name: string; delimiter?: string; flags?: Set<string> }[]

  console.log(`[sync] listing mailboxes on ${config.host}`)
  let listClient: ImapFlow | null = null
  try {
    listClient = await connectImap(config, 'list mailboxes')
    listed = await listClient.list()
    cachedMailboxes = listed.map((mb) => ({
      path: mb.path,
      name: mb.name,
      delimiter: mb.delimiter ?? '/'
    }))
    const selectable = listed.filter((mb) => !mb.flags?.has('\\Noselect'))
    console.log(
      `[sync] found ${listed.length} mailboxes (${selectable.length} selectable): ${selectable.map((mb) => mb.path).join(', ')}`
    )
  } finally {
    if (listClient) {
      try {
        await listClient.logout()
      } catch {
        /* ignore */
      }
    }
  }

  // Sync mailboxes sequentially — many IMAP servers reject multiple simultaneous connections
  // Skip \Noselect folders (container-only folders that can't be opened)
  for (const mb of listed) {
    if (mb.flags?.has('\\Noselect')) continue
    await syncOneMailbox(config, mb.path, pollMs)
  }
  console.log(`[sync] all mailboxes done`)
}

function scheduleSyncTimer(pollMs: number) {
  if (syncTimer) return
  syncTimer = setInterval(async () => {
    const cfg = await getImapConfig()
    if ('missing' in cfg) return
    if (!activeSync) {
      activeSync = runSyncAll(cfg).finally(() => {
        activeSync = null
      })
    }
  }, pollMs)
}

export async function startMailboxSync() {
  startMailboxCacheRefresh()

  const config = await getImapConfig()
  if ('missing' in config) return

  if (!activeSync) {
    activeSync = runSyncAll(config).finally(() => {
      activeSync = null
    })
  }

  scheduleSyncTimer(config.pollSeconds * 1000)
}

export async function getSyncSummary(): Promise<{
  syncing: boolean
  configured: boolean
  hasError: boolean
  lastSyncedAt: string | null
  errorMessage: string | null
  progress: { mailbox: string; stored: number; total: number } | null
}> {
  const config = await getImapConfig()
  if ('missing' in config) {
    return {
      syncing: false,
      configured: false,
      hasError: false,
      lastSyncedAt: null,
      errorMessage: null,
      progress: null
    }
  }

  const rows = await db.select().from(mailboxSync)

  // Only consider rows that have actually been synced (have a lastSyncedAt)
  const syncedRows = rows.filter((r) => r.lastSyncedAt !== null)
  const errorRows = syncedRows.filter((r) => r.lastError)
  const okRows = syncedRows.filter((r) => !r.lastError)

  // Report an error only when no mailbox synced successfully, or inbox specifically failed
  const hasError =
    errorRows.length > 0 && (okRows.length === 0 || errorRows.some((r) => /inbox/i.test(r.mailbox)))

  const errorMessage = errorRows[0]?.lastError ?? null
  const latest = syncedRows.reduce<Date | null>((max, r) => {
    if (!r.lastSyncedAt) return max
    return !max || r.lastSyncedAt > max ? r.lastSyncedAt : max
  }, null)

  return {
    syncing: activeSync !== null,
    configured: true,
    hasError,
    lastSyncedAt: latest?.toISOString() ?? null,
    errorMessage,
    progress: activeSyncProgress ? { ...activeSyncProgress } : null
  }
}

export async function getMailboxSyncStatus(mailboxPath: string): Promise<SyncResult> {
  const config = await getImapConfig()

  if ('missing' in config) {
    return {
      mailbox: mailboxPath,
      configured: false,
      skipped: true,
      syncing: false,
      fetchedCount: 0,
      storedCount: 0,
      lastSyncedAt: null,
      lastError: null,
      reason: `Missing ${config.missing.join(', ')}.`
    }
  }

  const state = await readSyncState(mailboxPath)

  if (!state) {
    return {
      mailbox: mailboxPath,
      configured: true,
      skipped: true,
      syncing: activeSync !== null,
      fetchedCount: 0,
      storedCount: 0,
      lastSyncedAt: null,
      lastError: null,
      reason: activeSync ? 'Background sync in progress.' : 'Waiting for first sync.'
    }
  }

  const pollMs = config.pollSeconds * 1000
  const lastSyncedAt = state.lastSyncedAt?.getTime() ?? 0
  const skipped = !!lastSyncedAt && Date.now() - lastSyncedAt < pollMs

  return {
    mailbox: mailboxPath,
    configured: true,
    skipped,
    syncing: activeSync !== null,
    fetchedCount: state.lastFetchedCount,
    storedCount: state.lastStoredCount,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    lastError: state.lastError ?? null,
    reason: activeSync
      ? 'Background sync in progress.'
      : skipped
        ? 'Mailbox sync is still fresh.'
        : state.lastError
          ? 'Mailbox sync failed.'
          : undefined
  }
}

export type ImapMailbox = {
  path: string
  name: string
  delimiter: string
}

let cachedMailboxes: ImapMailbox[] | null = null
const MAILBOX_REFRESH_MS = 10 * 60 * 1000
let mailboxRefreshTimer: ReturnType<typeof setInterval> | null = null

async function refreshMailboxCache(): Promise<void> {
  const config = await getImapConfig()
  if ('missing' in config) return

  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, 'mailbox cache refresh')
    const tree = await client.list()
    await client.logout()

    cachedMailboxes = tree.map((mb) => ({
      path: mb.path,
      name: mb.name,
      delimiter: mb.delimiter ?? '/'
    }))
  } catch {
    // keep existing cache on failure — retries exhausted or auth failure
  }
}

function startMailboxCacheRefresh() {
  if (mailboxRefreshTimer) return
  void refreshMailboxCache()
  mailboxRefreshTimer = setInterval(() => {
    void refreshMailboxCache()
  }, MAILBOX_REFRESH_MS)
}

export function listImapMailboxes(): ImapMailbox[] {
  return cachedMailboxes ?? []
}

const joinedSelect = {
  id: mailMessageMailbox.id,
  messageId: mailMessage.messageId,
  mailbox: mailMessageMailbox.mailbox,
  uid: mailMessageMailbox.uid,
  flags: mailMessageMailbox.flags,
  subject: mailMessage.subject,
  from: mailMessage.from,
  to: mailMessage.to,
  preview: mailMessage.preview,
  textContent: mailMessage.textContent,
  htmlContent: mailMessage.htmlContent,
  receivedAt: mailMessage.receivedAt
}

export async function listStoredMessages(mailboxPath: string, limit = 100, offset = 0) {
  return db
    .select(joinedSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.mailbox, mailboxPath))
    .orderBy(desc(mailMessage.receivedAt), desc(mailMessageMailbox.uid))
    .offset(offset)
    .limit(limit)
}

function buildFtsQuery(userQuery: string): string {
  return userQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '')}"*`)
    .join(' ')
}

export async function searchMessages(query: string, limit: number, offset: number) {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []

  let ftsRows: { rowid: number }[]
  try {
    ftsRows = db.all<{ rowid: number }>(
      sql`SELECT rowid FROM mail_message_fts WHERE mail_message_fts MATCH ${ftsQuery} ORDER BY rank LIMIT ${limit + offset}`
    )
  } catch {
    return []
  }

  if (!ftsRows.length) return []

  const pageIds = ftsRows.slice(offset, offset + limit).map((r) => r.rowid)
  if (!pageIds.length) return []

  const rows = await db
    .select(joinedSelect)
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(inArray(mailMessage.id, pageIds))
    .orderBy(desc(mailMessage.receivedAt))

  // Deduplicate: a message may appear in multiple mailboxes — keep first occurrence
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.messageId)) return false
    seen.add(row.messageId)
    return true
  })
}

export async function getStoredMessageById(id: string | number): Promise<MailRow | null> {
  const numericId = typeof id === 'string' ? parseInt(id, 10) : id
  const [message] = await db
    .select(joinedSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.id, numericId))
    .limit(1)

  return message ?? null
}

export async function markMessageAsRead(message: MailRow) {
  const config = await getImapConfig()
  if ('missing' in config) return

  const flags: string[] = JSON.parse(message.flags)
  if (flags.includes('\\Seen')) return

  await db
    .update(mailMessageMailbox)
    .set({ flags: JSON.stringify([...flags, '\\Seen']) })
    .where(eq(mailMessageMailbox.id, message.id))

  enqueueMarkRead(message.uid, message.mailbox)
}

export type MessageAction = 'archive' | 'trash' | 'spam' | 'inbox'

const ROLE_PATTERNS: Record<MessageAction, RegExp> = {
  inbox: /\binbox\b/i,
  archive: /\b(archive|all[\s._-]?mail)\b/i,
  trash: /\b(trash|deleted[\s._-]?(items|messages)?)\b/i,
  spam: /\b(spam|junk([\s._-]?email)?)\b/i
}

export function getMailboxRole(mailboxPath: string): MessageAction | null {
  for (const [role, pattern] of Object.entries(ROLE_PATTERNS) as [MessageAction, RegExp][]) {
    if (pattern.test(mailboxPath)) return role
  }
  return null
}

function findMailboxForAction(action: MessageAction): string | null {
  const mailboxes = cachedMailboxes ?? []
  const pattern = ROLE_PATTERNS[action]
  return mailboxes.find((mb) => pattern.test(mb.path) || pattern.test(mb.name))?.path ?? null
}

export async function moveMessage(message: MailRow, action: MessageAction): Promise<string | null> {
  const targetMailbox = findMailboxForAction(action)
  if (!targetMailbox || targetMailbox === message.mailbox) return null

  // Optimistically remove from source mailbox — next sync will add it to target
  await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, message.id))

  enqueueMoveMessage(message.uid, message.mailbox, targetMailbox)
  return targetMailbox
}
