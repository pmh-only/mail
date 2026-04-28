import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { slugToPath } from '../mailbox'
import { db } from './db'
import {
  mailboxCatalog,
  mailboxSync,
  mailMessage,
  mailMessageMailbox,
  mailThreadSummary,
  mailShare,
  mailAttachment,
  syncRuntime
} from './db/schema'
import { enqueueMarkRead, enqueueMoveMessage } from './imap-queue'
import { getImapConfig, type ImapConfig } from './config'
import { logServerError, perfError, perfLog, perfMs, perfNow } from './perf'
import { withRetry } from './retry'

const IMAP_CONNECT_TIMEOUT_MS = 20_000
const INITIAL_SYNC_FAILURE_RETRY_MS = 10 * 60 * 1000
const EMPTY_MAILBOX_ERROR_RE = /\bno such message\b/i

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
        try {
          client.close()
        } catch {
          /* ignore */
        }
        throw err
      }
    },
    { label, maxAttempts: 3, baseDelayMs: 2000 }
  )
}

export type MailListRow = {
  id: number // mail_message_mailbox.id
  messageId: string
  mailbox: string
  uid: number
  flags: string
  subject: string
  from: string
  to: string
  cc: string
  preview: string
  receivedAt: Date | null
  threadId: string | null
}

// Joined row returned by detail queries
export type MailRow = MailListRow & {
  textContent: string
  htmlContent: string | null
  inReplyTo: string | null
  references: string | null
}

export type ThreadRow = MailListRow & { threadCount: number }

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

type MailboxSyncRow = typeof mailboxSync.$inferSelect

// Yield control back to the Node.js event loop so HTTP requests can be served
// between sync chunks during large mailbox backfills.
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

let activeSync: Promise<void> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null

type ActiveSyncProgress = {
  mailbox: string
  stored: number
  total: number
}
let activeSyncProgress: ActiveSyncProgress | null = null

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

function sanitizePgText(value: string): string {
  return value.replace(/\0/g, '')
}

function sanitizeNullablePgText(value: string | null): string | null {
  return value === null ? null : sanitizePgText(value)
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

function isEmptyMailboxInitialSyncError(error: unknown) {
  return EMPTY_MAILBOX_ERROR_RE.test(getErrorMessage(error))
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
  const startedAt = Date.now()
  await db
    .insert(mailboxSync)
    .values({ mailbox, ...values })
    .onConflictDoUpdate({
      target: mailboxSync.mailbox,
      set: values
    })
  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(`[sync] ${mailbox}: saveSyncState ${ms}ms`)
  }
}

async function readSyncRuntime() {
  const [state] = await db.select().from(syncRuntime).where(eq(syncRuntime.id, 1)).limit(1)
  return state ?? null
}

async function saveSyncRuntime(values: Partial<typeof syncRuntime.$inferInsert>) {
  const current = await readSyncRuntime()
  const nextValues = { ...current, ...values }

  if (
    current &&
    current.isSyncing === nextValues.isSyncing &&
    current.activeMailbox === nextValues.activeMailbox &&
    current.activeStored === nextValues.activeStored &&
    current.activeTotal === nextValues.activeTotal &&
    (current.lastRunStartedAt?.getTime() ?? null) ===
      (nextValues.lastRunStartedAt instanceof Date
        ? nextValues.lastRunStartedAt.getTime()
        : null) &&
    (current.lastRunFinishedAt?.getTime() ?? null) ===
      (nextValues.lastRunFinishedAt instanceof Date
        ? nextValues.lastRunFinishedAt.getTime()
        : null) &&
    current.lastError === nextValues.lastError &&
    !values.workerHeartbeatAt
  ) {
    return
  }

  const startedAt = Date.now()
  await db
    .insert(syncRuntime)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: syncRuntime.id,
      set: values
    })
  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(
      `[sync] runtime: saveSyncRuntime ${ms}ms mailbox=${values.activeMailbox ?? '-'} syncing=${values.isSyncing ?? '-'}`
    )
  }
}

async function setSyncProgress(mailbox: string | null, stored: number, total: number) {
  activeSyncProgress = mailbox ? { mailbox, stored, total } : null
  await saveSyncRuntime({
    isSyncing: mailbox !== null,
    activeMailbox: mailbox,
    activeStored: stored,
    activeTotal: total,
    workerHeartbeatAt: new Date()
  })
}

export async function touchSyncWorkerHeartbeat() {
  await saveSyncRuntime({ workerHeartbeatAt: new Date() })
}

function fallbackMailboxName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

function isAllMailMailbox(path: string) {
  return /\ball[\s._-]?mail\b/i.test(path)
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function getMailboxSortRank(mailbox: { path: string; name: string }) {
  const value = `${mailbox.path} ${mailbox.name}`.toLowerCase()
  if (/\binbox\b/.test(value)) return 0
  if (/\b(sent|sent items|sent messages)\b/.test(value)) return 1
  if (/\b(drafts?)\b/.test(value)) return 2
  if (/\b(archive|all[\s._-]?mail)\b/.test(value)) return 3
  if (/\b(spam|junk([\s._-]?email)?)\b/.test(value)) return 4
  if (/\b(trash|deleted[\s._-]?(items|messages)?)\b/.test(value)) return 5
  return 6
}

function sortImapMailboxes<T extends { path: string; name: string }>(mailboxes: T[]) {
  return [...mailboxes].sort((left, right) => {
    const rankDiff = getMailboxSortRank(left) - getMailboxSortRank(right)
    if (rankDiff !== 0) return rankDiff

    const nameDiff = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    if (nameDiff !== 0) return nameDiff

    return left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  })
}

async function readMailboxCatalogRows(): Promise<ImapMailbox[]> {
  const rows = await db
    .select({
      path: mailboxCatalog.path,
      name: mailboxCatalog.name,
      delimiter: mailboxCatalog.delimiter
    })
    .from(mailboxCatalog)
    .orderBy(asc(mailboxCatalog.path))

  if (rows.length > 0) {
    return sortImapMailboxes(
      rows.map((row: { path: string; name: string; delimiter: string }) => ({
        path: row.path,
        name: row.name,
        delimiter: row.delimiter
      }))
    )
  }

  const syncRows = await db.select({ path: mailboxSync.mailbox }).from(mailboxSync)
  const messageRows = await db
    .selectDistinct({ path: mailMessageMailbox.mailbox })
    .from(mailMessageMailbox)
  const fallbackRows = [...syncRows, ...messageRows].sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  )

  return sortImapMailboxes(
    fallbackRows.map((row: { path: string }) => ({
      path: row.path,
      name: fallbackMailboxName(row.path),
      delimiter: '/'
    }))
  )
}

async function replaceMailboxCatalog(mailboxes: ImapMailbox[]) {
  const current = await readMailboxCatalogRows()
  if (
    current.length === mailboxes.length &&
    current.every((row, index) => {
      const next = mailboxes[index]
      return (
        row?.path === next?.path && row?.name === next?.name && row?.delimiter === next?.delimiter
      )
    })
  ) {
    return
  }

  const now = new Date()
  await db.delete(mailboxCatalog)
  if (mailboxes.length > 0) {
    await db.insert(mailboxCatalog).values(
      mailboxes.map((mailbox) => ({
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter,
        updatedAt: now
      }))
    )
  }
}

// Resolve a stable thread key by walking In-Reply-To / References chains.
// The key is stored separately from the legacy threadId column so mailbox
// summaries can rely on a non-null identifier.
async function resolveThreadKey(
  references: string[],
  inReplyTo: string | null,
  ownId: string
): Promise<string> {
  const startedAt = Date.now()
  const candidates = [...references, inReplyTo].filter((x): x is string => !!x)
  if (candidates.length === 0) return ownId
  const [existing] = await db
    .select({ threadKey: mailMessage.threadKey })
    .from(mailMessage)
    .where(inArray(mailMessage.messageId, candidates))
    .limit(1)
  const resolved = existing?.threadKey ?? candidates[0] ?? ownId
  const ms = Date.now() - startedAt
  if (ms >= 50) {
    console.log(
      `[sync] resolveThreadKey ${ms}ms candidates=${candidates.length} resolved=${resolved === ownId ? 'self' : 'linked'}`
    )
  }
  return resolved
}

// Store or skip message content (skipped if message_id already exists).
// Returns the stable thread key and whether a new message row was inserted.
async function storeMessageContent(
  effectiveMessageId: string,
  message: Awaited<ReturnType<typeof simpleParser>>,
  internalDate?: Date
): Promise<{ isNew: boolean; threadKey: string }> {
  const startedAt = Date.now()
  const sanitizedMessageId = sanitizePgText(effectiveMessageId)
  const receivedAt = message.date ?? internalDate ?? null
  const textContent = sanitizePgText(message.text?.trim() ?? '')
  const htmlContent = sanitizeNullablePgText(typeof message.html === 'string' ? message.html : null)

  // Parse threading headers
  const inReplyTo = sanitizeNullablePgText(message.inReplyTo ?? null)
  const references = sanitizeNullablePgText(
    Array.isArray(message.references)
      ? message.references.join(' ')
      : ((message.references as string | undefined) ?? null)
  )
  const cc = sanitizePgText(
    summarizeAddresses(message.cc as Parameters<typeof summarizeAddresses>[0])
  )

  // Resolve thread key
  const refList = references ? references.split(/\s+/).filter(Boolean) : []
  const threadKey = await resolveThreadKey(refList, inReplyTo, sanitizedMessageId)

  const result = await db
    .insert(mailMessage)
    .values({
      messageId: sanitizedMessageId,
      subject: sanitizePgText(message.subject?.trim() ?? '(no subject)'),
      from: sanitizePgText(summarizeAddresses(message.from)),
      to: sanitizePgText(summarizeAddresses(message.to)),
      cc,
      preview: createPreview(textContent),
      textContent,
      htmlContent,
      inReplyTo,
      references,
      threadId: threadKey,
      threadKey,
      receivedAt
    })
    .onConflictDoNothing()
    .returning({ id: mailMessage.id })

  const isNew = result.length > 0

  // Store attachments for newly inserted messages only
  if (isNew && message.attachments?.length) {
    for (const att of message.attachments) {
      // Skip inline images — they're already embedded in htmlContent
      if (att.contentDisposition === 'inline') continue
      if (!att.content) continue
      try {
        await db.insert(mailAttachment).values({
          messageId: sanitizedMessageId,
          filename: sanitizePgText(att.filename ?? 'attachment'),
          contentType: sanitizePgText(att.contentType ?? 'application/octet-stream'),
          size: att.size ?? att.content.length,
          content: att.content
        })
      } catch {
        // Ignore duplicate attachment errors
      }
    }
  }

  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(
      `[sync] storeMessageContent ${sanitizedMessageId} ${ms}ms threadKey=${threadKey} isNew=${isNew}`
    )
  }

  return { isNew, threadKey }
}

// Insert or update the per-mailbox entry for a message
async function storeMailboxEntry(
  effectiveMessageId: string,
  mailbox: string,
  uid: number,
  flags: string[],
  receivedAt?: Date | null
) {
  const startedAt = Date.now()
  const sanitizedMessageId = sanitizePgText(effectiveMessageId)
  const sanitizedMailbox = sanitizePgText(mailbox)
  await db
    .insert(mailMessageMailbox)
    .values({
      messageId: sanitizedMessageId,
      mailbox: sanitizedMailbox,
      uid,
      flags: JSON.stringify(flags),
      receivedAt: receivedAt ?? null,
      syncedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
      set: {
        messageId: sanitizedMessageId,
        flags: JSON.stringify(flags),
        receivedAt: receivedAt ?? null,
        syncedAt: new Date()
      }
    })

  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(`[sync] ${mailbox}: storeMailboxEntry uid=${uid} ${ms}ms`)
  }
}

async function syncOneMailbox(
  config: ImapConfig,
  mailboxPath: string,
  pollMs: number
): Promise<void> {
  const state = await readSyncState(mailboxPath)
  const historyComplete = state?.historyComplete ?? false
  let nextLastUid = state?.lastUid ?? 0
  const lastSyncedAt = state?.lastSyncedAt?.getTime() ?? 0
  const initialSyncFailedBefore =
    !historyComplete && nextLastUid === 0 && Boolean(state?.lastError?.trim())
  const retryDelayMs = initialSyncFailedBefore
    ? Math.max(pollMs, INITIAL_SYNC_FAILURE_RETRY_MS)
    : pollMs

  if (lastSyncedAt && Date.now() - lastSyncedAt < retryDelayMs) return

  let fetchedCount = 0
  let storedCount = 0

  const t0 = Date.now()
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

  await setSyncProgress(mailboxPath, 0, 0)
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

      console.log(`[sync] ${mailboxPath}: fetching envelopes range=${range} (${elapsed()})`)

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
        const msgId = sanitizePgText(
          (item.envelope as { messageId?: string } | undefined)?.messageId?.trim() ?? ''
        )
        const effectiveMessageId = msgId || `synthetic:${sanitizePgText(mailboxPath)}:${item.uid}`
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
        const existingRows = await db
          .select({ messageId: mailMessage.messageId, threadKey: mailMessage.threadKey })
          .from(mailMessage)
          .where(inArray(mailMessage.messageId, allMessageIds))

        const existingIds = new Set(existingRows.map((row: { messageId: string }) => row.messageId))
        const touchedThreadKeys = new Set<string>()

        const needsSourceItems = envelopeItems.filter((i) => !existingIds.has(i.effectiveMessageId))
        const cachedItems = envelopeItems.filter((i) => existingIds.has(i.effectiveMessageId))
        const cachedCount = fetchedCount - needsSourceItems.length

        await setSyncProgress(mailboxPath, 0, fetchedCount)

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
          if (isAllMailMailbox(mailboxPath)) {
            storedCount += cachedItems.length
            await setSyncProgress(mailboxPath, storedCount, fetchedCount)
            console.log(
              `[sync] ${mailboxPath}: skipped ${cachedItems.length} cached mailbox entry upserts (${elapsed()})`
            )
          } else {
            const CHUNK_SIZE = 200
            console.log(
              `[sync] ${mailboxPath}: updating ${cachedItems.length} cached mailbox entries...`
            )
            for (let ci = 0; ci < cachedItems.length; ci += CHUNK_SIZE) {
              const chunk = cachedItems.slice(ci, ci + CHUNK_SIZE)
              for (const item of chunk) {
                await db
                  .insert(mailMessageMailbox)
                  .values({
                    messageId: item.effectiveMessageId,
                    mailbox: mailboxPath,
                    uid: item.uid,
                    flags: JSON.stringify(item.flags),
                    receivedAt: item.internalDate ?? null,
                    syncedAt: new Date()
                  })
                  .onConflictDoUpdate({
                    target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
                    set: {
                      messageId: item.effectiveMessageId,
                      flags: JSON.stringify(item.flags),
                      receivedAt: item.internalDate ?? null,
                      syncedAt: new Date()
                    }
                  })
              }
              storedCount += chunk.length
              await setSyncProgress(mailboxPath, storedCount, fetchedCount)
              if (storedCount % 500 === 0) {
                console.log(
                  `[sync] ${mailboxPath}: updated ${storedCount}/${fetchedCount} entries (${elapsed()})`
                )
              }
              await yieldToEventLoop()
            }
            console.log(`[sync] ${mailboxPath}: cached entries updated (${elapsed()})`)
          }
        }

        // Phase 3b: fetch source newest-first, in batches so recent mail lands in DB first
        const newlyStoredMessageIds: string[] = []
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
              const storedMessage = await storeMessageContent(
                item.effectiveMessageId,
                parsed,
                item.internalDate
              )
              if (storedMessage.isNew) newlyStoredMessageIds.push(item.effectiveMessageId)
              touchedThreadKeys.add(storedMessage.threadKey)
              await storeMailboxEntry(
                item.effectiveMessageId,
                mailboxPath,
                item.uid,
                item.flags,
                item.internalDate
              )
              storedCount += 1
              if (storedCount % 100 === 0 || storedCount === fetchedCount) {
                await setSyncProgress(mailboxPath, storedCount, fetchedCount)
              }
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

        // Run filter rules on newly stored messages
        if (newlyStoredMessageIds.length > 0) {
          const filterStartedAt = Date.now()
          const { runFiltersOnMessages } = await import('./filters')
          await runFiltersOnMessages(newlyStoredMessageIds)
          const filterMs = Date.now() - filterStartedAt
          if (filterMs >= 100) {
            console.log(
              `[sync] ${mailboxPath}: runFiltersOnMessages ${newlyStoredMessageIds.length} messages ${filterMs}ms`
            )
          }
        }

        if (touchedThreadKeys.size > 0) {
          await refreshThreadSummaries(mailboxPath, touchedThreadKeys)
        }

        // Send push notifications for new messages
        if (newlyStoredMessageIds.length > 0) {
          try {
            const { sendPushToAll } = await import('./push')
            const newMsgs = await db
              .select({ subject: mailMessage.subject, from: mailMessage.from })
              .from(mailMessage)
              .where(inArray(mailMessage.messageId, newlyStoredMessageIds))
              .limit(5)
            for (const msg of newMsgs) {
              const senderMatch = msg.from?.match(/^([^<]+)</)
              const sender = senderMatch ? senderMatch[1].trim() : (msg.from ?? 'Unknown')
              await sendPushToAll({
                title: msg.subject ?? '(no subject)',
                body: `From: ${sender}`,
                url: `/${encodeURIComponent(mailboxPath)}`
              })
            }
          } catch {
            // push is optional — never fail sync
          }
        }
      }
    } finally {
      lock.release()
    }

    await saveSyncRuntime({ workerHeartbeatAt: new Date() })
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
    const errorMessage = getErrorMessage(error)
    const emptyMailboxDuringInitialSync =
      fetchedCount === 0 &&
      nextLastUid === 0 &&
      !historyComplete &&
      isEmptyMailboxInitialSyncError(error)

    if (emptyMailboxDuringInitialSync) {
      console.warn(
        `[sync] ${mailboxPath}: initial backfill returned no messages; marking mailbox initialized (${elapsed()})`
      )
      await saveSyncState(mailboxPath, {
        lastUid: 0,
        historyComplete: true,
        lastFetchedCount: 0,
        lastStoredCount: 0,
        lastSyncedAt: new Date(),
        lastError: null
      })
      return
    }

    console.error(`[sync] ${mailboxPath}: error after ${elapsed()} — ${errorMessage}`)
    await saveSyncState(mailboxPath, {
      lastUid: nextLastUid,
      historyComplete,
      lastFetchedCount: fetchedCount || (state?.lastFetchedCount ?? 0),
      lastStoredCount: storedCount || (state?.lastStoredCount ?? 0),
      lastSyncedAt: new Date(),
      lastError: errorMessage
    })
    throw error
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

  await saveSyncRuntime({
    isSyncing: true,
    activeMailbox: null,
    activeStored: 0,
    activeTotal: 0,
    lastRunStartedAt: new Date(),
    workerHeartbeatAt: new Date(),
    lastError: null
  })

  try {
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
      await replaceMailboxCatalog(cachedMailboxes)
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

    for (const mb of listed) {
      if (mb.flags?.has('\\Noselect')) continue
      await syncOneMailbox(config, mb.path, pollMs)
    }

    console.log(`[sync] all mailboxes done`)
    activeSyncProgress = null
    await saveSyncRuntime({
      isSyncing: false,
      activeMailbox: null,
      activeStored: 0,
      activeTotal: 0,
      lastRunFinishedAt: new Date(),
      workerHeartbeatAt: new Date(),
      lastError: null
    })
  } catch (error) {
    activeSyncProgress = null
    await saveSyncRuntime({
      isSyncing: false,
      activeMailbox: null,
      activeStored: 0,
      activeTotal: 0,
      lastRunFinishedAt: new Date(),
      workerHeartbeatAt: new Date(),
      lastError: getErrorMessage(error)
    })
    throw error
  }
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
  const startedAt = perfNow()
  const config = await getImapConfig()
  const runtime = await readSyncRuntime()
  if ('missing' in config) {
    const summary = {
      syncing: false,
      configured: false,
      hasError: false,
      lastSyncedAt: null,
      errorMessage: null,
      progress: null
    }

    perfLog('mail.getSyncSummary', {
      configured: false,
      rows: 0,
      ms: perfMs(startedAt)
    })

    return summary
  }

  const rows = (await db.select().from(mailboxSync)) as MailboxSyncRow[]

  // Only consider rows that have actually been synced (have a lastSyncedAt)
  const syncedRows = rows.filter((r) => r.lastSyncedAt !== null)
  const errorRows = syncedRows.filter((r) => r.lastError)
  const okRows = syncedRows.filter((r) => !r.lastError)

  // Report an error only when no mailbox synced successfully, or inbox specifically failed
  const hasError =
    !!runtime?.lastError ||
    (errorRows.length > 0 &&
      (okRows.length === 0 || errorRows.some((r) => /inbox/i.test(r.mailbox))))

  const errorMessage = runtime?.lastError ?? errorRows[0]?.lastError ?? null
  const latest = syncedRows.reduce((max: Date | null, r) => {
    if (!r.lastSyncedAt) return max
    return !max || r.lastSyncedAt > max ? r.lastSyncedAt : max
  }, null)

  const summary = {
    syncing: runtime?.isSyncing ?? false,
    configured: true,
    hasError,
    lastSyncedAt: latest?.toISOString() ?? null,
    errorMessage,
    progress:
      runtime?.isSyncing && runtime.activeMailbox
        ? {
            mailbox: runtime.activeMailbox,
            stored: runtime.activeStored,
            total: runtime.activeTotal
          }
        : null
  }

  perfLog('mail.getSyncSummary', {
    configured: true,
    rows: rows.length,
    syncedRows: syncedRows.length,
    errorRows: errorRows.length,
    ms: perfMs(startedAt)
  })

  return summary
}

export async function getMailboxSyncStatus(mailboxPath: string): Promise<SyncResult> {
  const config = await getImapConfig()
  const runtime = await readSyncRuntime()

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
      syncing: runtime?.isSyncing ?? false,
      fetchedCount: 0,
      storedCount: 0,
      lastSyncedAt: null,
      lastError: null,
      reason: runtime?.isSyncing ? 'Background sync in progress.' : 'Waiting for first sync.'
    }
  }

  const pollMs = config.pollSeconds * 1000
  const lastSyncedAt = state.lastSyncedAt?.getTime() ?? 0
  const skipped = !!lastSyncedAt && Date.now() - lastSyncedAt < pollMs

  return {
    mailbox: mailboxPath,
    configured: true,
    skipped,
    syncing: runtime?.isSyncing ?? false,
    fetchedCount: state.lastFetchedCount,
    storedCount: state.lastStoredCount,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    lastError: state.lastError ?? null,
    reason: runtime?.isSyncing
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
let mailboxRefreshPromise: Promise<ImapMailbox[]> | null = null

async function refreshMailboxCache(): Promise<ImapMailbox[]> {
  if (mailboxRefreshPromise) return mailboxRefreshPromise

  mailboxRefreshPromise = (async () => {
    const config = await getImapConfig()
    if ('missing' in config) return cachedMailboxes ?? []

    try {
      const client = await connectImap(config, 'mailbox cache refresh')
      const tree = await client.list()
      await client.logout()

      cachedMailboxes = sortImapMailboxes(
        tree.map((mb) => ({
          path: mb.path,
          name: mb.name,
          delimiter: mb.delimiter ?? '/'
        }))
      )
      await replaceMailboxCatalog(cachedMailboxes)
    } catch {
      // keep existing cache on failure — retries exhausted or auth failure
    }

    return cachedMailboxes ?? []
  })().finally(() => {
    mailboxRefreshPromise = null
  })

  return mailboxRefreshPromise
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

export async function getImapMailboxes(options?: {
  waitForCache?: boolean
}): Promise<ImapMailbox[]> {
  const rows = await readMailboxCatalogRows()
  if (rows.length > 0) return rows
  if (!options?.waitForCache) return rows
  return refreshMailboxCache()
}

export async function resolveMailboxPath(
  mailboxSlug: string,
  mailboxes: { path: string }[] = []
): Promise<string> {
  const knownMailboxes = mailboxes.length > 0 ? mailboxes : await getImapMailboxes()
  return slugToPath(mailboxSlug, knownMailboxes)
}

const listSelect = {
  id: mailMessageMailbox.id,
  messageId: mailMessage.messageId,
  mailbox: mailMessageMailbox.mailbox,
  uid: mailMessageMailbox.uid,
  flags: mailMessageMailbox.flags,
  subject: mailMessage.subject,
  from: mailMessage.from,
  to: mailMessage.to,
  cc: mailMessage.cc,
  preview: mailMessage.preview,
  receivedAt: mailMessage.receivedAt,
  threadId: mailMessage.threadKey
}

const detailSelect = {
  ...listSelect,
  textContent: mailMessage.textContent,
  htmlContent: mailMessage.htmlContent,
  inReplyTo: mailMessage.inReplyTo,
  references: mailMessage.references
}

async function refreshThreadSummary(mailbox: string, threadKey: string) {
  const [candidateRow] = await db
    .select({
      representativeMailboxEntryId: mailMessageMailbox.id,
      latestUid: mailMessageMailbox.uid,
      latestReceivedAt: mailMessageMailbox.receivedAt
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(eq(mailMessageMailbox.mailbox, mailbox), eq(mailMessage.threadKey, threadKey)))
    .orderBy(desc(mailMessageMailbox.receivedAt), desc(mailMessageMailbox.uid))
    .limit(1)

  if (!candidateRow) {
    await db
      .delete(mailThreadSummary)
      .where(
        and(eq(mailThreadSummary.mailbox, mailbox), eq(mailThreadSummary.threadKey, threadKey))
      )
    return
  }

  const [countRow] = await db
    .select({ value: count() })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(eq(mailMessageMailbox.mailbox, mailbox), eq(mailMessage.threadKey, threadKey)))

  await db
    .insert(mailThreadSummary)
    .values({
      mailbox,
      threadKey,
      representativeMailboxEntryId: candidateRow.representativeMailboxEntryId,
      threadCount: Number(countRow?.value ?? 0),
      latestUid: candidateRow.latestUid,
      latestReceivedAt: candidateRow.latestReceivedAt
    })
    .onConflictDoUpdate({
      target: [mailThreadSummary.mailbox, mailThreadSummary.threadKey],
      set: {
        representativeMailboxEntryId: candidateRow.representativeMailboxEntryId,
        threadCount: Number(countRow?.value ?? 0),
        latestUid: candidateRow.latestUid,
        latestReceivedAt: candidateRow.latestReceivedAt
      }
    })
}

export async function refreshThreadSummaries(mailbox: string, threadKeys: Iterable<string>) {
  const uniqueThreadKeys = Array.from(
    new Set(Array.from(threadKeys).filter((threadKey): threadKey is string => threadKey.length > 0))
  )

  if (uniqueThreadKeys.length === 0) return

  const startedAt = Date.now()
  for (const threadKey of uniqueThreadKeys) {
    await refreshThreadSummary(mailbox, threadKey)
  }
  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(`[sync] ${mailbox}: refreshThreadSummaries ${uniqueThreadKeys.length} keys ${ms}ms`)
  }
}

export async function listStoredMessages(mailboxPath: string, limit = 100, offset = 0) {
  const startedAt = perfNow()

  try {
    const rows = await db
      .select(listSelect)
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(eq(mailMessageMailbox.mailbox, mailboxPath))
      .orderBy(desc(mailMessageMailbox.receivedAt), desc(mailMessageMailbox.uid))
      .limit(limit)
      .offset(offset)

    perfLog('mail.listStoredMessages', {
      mailbox: mailboxPath,
      limit,
      offset,
      rows: rows.length,
      ms: perfMs(startedAt)
    })

    return rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt != null ? new Date(row.receivedAt) : null
    }))
  } catch (error) {
    perfLog('mail.listStoredMessages', {
      mailbox: mailboxPath,
      limit,
      offset,
      ms: perfMs(startedAt),
      error: perfError(error)
    })
    throw error
  }
}

export async function countStoredMessages(mailboxPath: string) {
  const [row] = await db
    .select({ value: count() })
    .from(mailMessageMailbox)
    .where(eq(mailMessageMailbox.mailbox, mailboxPath))

  return Number(row?.value ?? 0)
}

// Returns one representative message per thread, ordered by most recent activity.
export async function listStoredThreads(
  mailboxPath: string,
  limit = 100,
  offset = 0
): Promise<ThreadRow[]> {
  const startedAt = perfNow()

  try {
    const rows = await db
      .select({
        id: mailMessageMailbox.id,
        messageId: mailMessage.messageId,
        mailbox: mailThreadSummary.mailbox,
        uid: mailMessageMailbox.uid,
        flags: mailMessageMailbox.flags,
        subject: mailMessage.subject,
        from: mailMessage.from,
        to: mailMessage.to,
        cc: mailMessage.cc,
        preview: mailMessage.preview,
        receivedAt: mailThreadSummary.latestReceivedAt,
        threadId: mailThreadSummary.threadKey,
        threadCount: mailThreadSummary.threadCount
      })
      .from(mailThreadSummary)
      .innerJoin(
        mailMessageMailbox,
        eq(mailMessageMailbox.id, mailThreadSummary.representativeMailboxEntryId)
      )
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(eq(mailThreadSummary.mailbox, mailboxPath))
      .orderBy(desc(mailThreadSummary.latestReceivedAt), desc(mailThreadSummary.latestUid))
      .limit(limit)
      .offset(offset)

    perfLog('mail.listStoredThreads', {
      mailbox: mailboxPath,
      limit,
      offset,
      rows: rows.length,
      ms: perfMs(startedAt)
    })

    return rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt != null ? new Date(row.receivedAt) : null
    }))
  } catch (error) {
    perfLog('mail.listStoredThreads', {
      mailbox: mailboxPath,
      limit,
      offset,
      ms: perfMs(startedAt),
      error: perfError(error)
    })
    throw error
  }
}

export async function countStoredThreads(mailboxPath: string) {
  const [row] = await db
    .select({ value: count() })
    .from(mailThreadSummary)
    .where(eq(mailThreadSummary.mailbox, mailboxPath))

  return Number(row?.value ?? 0)
}

// Returns all messages belonging to a thread, ordered oldest-first.
export async function getMessagesInThread(
  threadKey: string,
  mailboxPath: string
): Promise<MailRow[]> {
  const startedAt = perfNow()

  try {
    const threadMessages = await db
      .select({ messageId: mailMessage.messageId })
      .from(mailMessage)
      .where(eq(mailMessage.threadKey, threadKey))
      .orderBy(asc(mailMessage.receivedAt), asc(mailMessage.messageId))

    if (threadMessages.length === 0) {
      perfLog('mail.getMessagesInThread', {
        mailbox: mailboxPath,
        threadId: threadKey,
        rows: 0,
        ms: perfMs(startedAt)
      })

      return []
    }

    const rows = await db
      .select(detailSelect)
      .from(mailMessage)
      .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(
        and(
          eq(mailMessageMailbox.mailbox, mailboxPath),
          inArray(
            mailMessage.messageId,
            threadMessages.map((message: { messageId: string }) => message.messageId)
          )
        )
      )
      .orderBy(asc(mailMessage.receivedAt), asc(mailMessageMailbox.uid))

    perfLog('mail.getMessagesInThread', {
      mailbox: mailboxPath,
      threadId: threadKey,
      rows: rows.length,
      ms: perfMs(startedAt)
    })

    return rows
  } catch (error) {
    perfLog('mail.getMessagesInThread', {
      mailbox: mailboxPath,
      threadId: threadKey,
      ms: perfMs(startedAt),
      error: perfError(error)
    })
    throw error
  }
}

export async function splitThreadFromMessage(
  threadKey: string,
  mailboxPath: string,
  mailboxEntryId: number
): Promise<{ threadKey: string; splitCount: number; remainingCount: number } | null> {
  const currentThreadRows = await db
    .select({
      messageId: mailMessage.messageId,
      mailboxEntryId: mailMessageMailbox.id,
      receivedAt: mailMessage.receivedAt,
      uid: mailMessageMailbox.uid
    })
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(eq(mailMessageMailbox.mailbox, mailboxPath), eq(mailMessage.threadKey, threadKey)))
    .orderBy(asc(mailMessage.receivedAt), asc(mailMessageMailbox.uid))

  const splitIndex = currentThreadRows.findIndex((row) => row.mailboxEntryId === mailboxEntryId)
  if (splitIndex <= 0) return null

  const splitMessageIds = currentThreadRows.slice(splitIndex).map((row) => row.messageId)
  if (splitMessageIds.length === 0 || splitMessageIds.length === currentThreadRows.length) {
    return null
  }

  const affectedMailboxRows = await db
    .select({
      mailbox: mailMessageMailbox.mailbox,
      messageId: mailMessageMailbox.messageId
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessage.threadKey, threadKey))

  const allAffectedMailboxes = new Set(affectedMailboxRows.map((row) => row.mailbox))
  const splitAffectedMailboxes = new Set(
    affectedMailboxRows
      .filter((row) => splitMessageIds.includes(row.messageId))
      .map((row) => row.mailbox)
  )

  const selectedMessageId = splitMessageIds[0]
  const newThreadKey = `${selectedMessageId}#split-${randomUUID()}`

  await db
    .update(mailMessage)
    .set({ threadId: newThreadKey, threadKey: newThreadKey })
    .where(inArray(mailMessage.messageId, splitMessageIds))

  for (const mailbox of allAffectedMailboxes) {
    await refreshThreadSummaries(mailbox, [threadKey])
  }
  for (const mailbox of splitAffectedMailboxes) {
    await refreshThreadSummaries(mailbox, [newThreadKey])
  }

  return {
    threadKey: newThreadKey,
    splitCount: splitMessageIds.length,
    remainingCount: currentThreadRows.length - splitMessageIds.length
  }
}

export async function searchMessages(query: string, limit: number, offset: number) {
  const startedAt = perfNow()
  if (!query.trim()) {
    perfLog('mail.searchMessages', {
      query,
      limit,
      offset,
      rows: 0,
      ms: perfMs(startedAt),
      skipped: true
    })
    return []
  }

  const pattern = `%${query}%`
  const rows = await db
    .select(listSelect)
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(
      or(
        ilike(mailMessage.subject, pattern),
        ilike(mailMessage.from, pattern),
        ilike(mailMessage.to, pattern),
        ilike(mailMessage.textContent, pattern)
      )
    )
    .orderBy(desc(mailMessage.receivedAt))
    .limit(limit + offset)

  // Deduplicate: a message may appear in multiple mailboxes — keep first occurrence
  const seen = new Set<string>()
  const deduped = rows.filter((row) => {
    if (seen.has(row.messageId)) return false
    seen.add(row.messageId)
    return true
  })

  perfLog('mail.searchMessages', {
    query,
    limit,
    offset,
    hydratedRows: rows.length,
    rows: deduped.length,
    ms: perfMs(startedAt)
  })

  return deduped
}

export async function countSearchMessages(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return 0

  const pattern = `%${trimmed}%`
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${mailMessage.messageId})` })
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(
      or(
        ilike(mailMessage.subject, pattern),
        ilike(mailMessage.from, pattern),
        ilike(mailMessage.to, pattern),
        ilike(mailMessage.textContent, pattern)
      )
    )

  return Number(row?.value ?? 0)
}

export async function getStoredMessageById(id: string | number): Promise<MailRow | null> {
  const numericId = typeof id === 'string' ? parseInt(id, 10) : id
  const [message] = await db
    .select(detailSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.id, numericId))
    .limit(1)

  return message ?? null
}

export async function markMessageAsRead(message: MailRow) {
  const flags: string[] = JSON.parse(message.flags)
  if (flags.includes('\\Seen')) return

  try {
    await db
      .update(mailMessageMailbox)
      .set({ flags: JSON.stringify([...flags, '\\Seen']) })
      .where(eq(mailMessageMailbox.id, message.id))
  } catch (error) {
    logServerError('mail.markMessageAsRead.update', error, {
      messageId: message.id,
      mailbox: message.mailbox,
      uid: message.uid
    })
  }

  try {
    await enqueueMarkRead(message.uid, message.mailbox)
  } catch (error) {
    logServerError('mail.markMessageAsRead.enqueue', error, {
      messageId: message.id,
      mailbox: message.mailbox,
      uid: message.uid
    })
  }
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

async function findMailboxForAction(action: MessageAction): Promise<string | null> {
  const mailboxes = await getImapMailboxes()
  const pattern = ROLE_PATTERNS[action]
  return mailboxes.find((mb) => pattern.test(mb.path) || pattern.test(mb.name))?.path ?? null
}

export async function createShareToken(mailboxEntryId: number): Promise<string | null> {
  const [row] = await db
    .select({ messageId: mailMessage.messageId })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.id, mailboxEntryId))
    .limit(1)

  if (!row) return null

  const token = randomUUID()
  await db.insert(mailShare).values({ token, messageId: row.messageId })
  return token
}

export async function getMessageByShareToken(token: string): Promise<MailRow | null> {
  const [share] = await db.select().from(mailShare).where(eq(mailShare.token, token)).limit(1)

  if (!share) return null

  const [message] = await db
    .select(detailSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessage.messageId, share.messageId))
    .limit(1)

  return message ?? null
}

export async function moveMessage(message: MailRow, action: MessageAction): Promise<string | null> {
  const targetMailbox = await findMailboxForAction(action)
  if (!targetMailbox || targetMailbox === message.mailbox) return null

  // Optimistically remove from source mailbox — next sync will add it to target
  await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, message.id))
  await refreshThreadSummaries(message.mailbox, [message.threadId ?? message.messageId])

  await enqueueMoveMessage(message.uid, message.mailbox, targetMailbox)
  return targetMailbox
}
