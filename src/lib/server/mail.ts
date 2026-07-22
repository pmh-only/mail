import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notLike,
  or,
  sql
} from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { readKey, type PublicKey } from 'openpgp'
import {
  ensureSeenFlag,
  isAlwaysReadMailbox,
  normalizeMailboxFlags,
  pathToSlug,
  slugToPath
} from '../mailbox'
import { changedReadStateCopies, isSeenFlags } from '../read-state'
import {
  condstoreChangedSince,
  imapKeepaliveDue,
  isCondstoreRejection,
  newUidRange,
  reconcileMailboxRows,
  seenJob,
  seenJobMatchesFlags,
  shouldUseStatusFastPath,
  syncBatchComplete,
  uidFetchRange,
  uidValidityChanged
} from '../imap-sync'
import { client, db } from './db'
import {
  mailboxCatalog,
  mailboxSync,
  mailMessage,
  mailMessageMailbox,
  mailThreadSummary,
  mailThreadMetadata,
  mailThreadNote,
  mailShare,
  mailAttachment,
  imapJob,
  syncRuntime
} from './db/schema'
import { scheduleMoveMessage } from './imap-operations'
import { getImapConfig, getImapConfigs, type ImapConfig } from './config'
import { logServerError, perfError, perfLog, perfMs, perfNow } from './perf'
import { withRetry } from './retry'
import { getWorkerConnection, invalidateWorkerConnection } from './imap-connections'
import { parseAddressFields, upsertContacts } from './contacts'
import { parseMailAuthentication } from '../mail-authentication'
import { env } from '$env/dynamic/private'
import {
  countDemoSearchMessages,
  countDemoStoredMessages,
  countDemoStoredThreads,
  createDemoShareToken,
  getDemoImapMailboxes,
  getDemoMailboxSyncStatus,
  getDemoMessageByShareToken,
  getDemoStoredMessageById,
  getDemoSyncSummary,
  getDemoMessagesInThread,
  isDemoModeEnabled,
  listDemoStoredMessages,
  listDemoStoredThreads,
  markDemoMessageAsRead,
  markDemoMessageAsUnread,
  moveDemoMessage,
  searchDemoMessages,
  searchDemoMessagesByRegex,
  snoozeDemoMessages
} from './demo'
import { assignThreadKeys, orderThread, referenceCandidates } from './threading'
import { processInboundOpenPgp, type OpenPgpSecurityResult } from './openpgp-message'
import { getOpenPgpPrivateKeys, getOpenPgpPublicKeys } from './openpgp-keys'

const INITIAL_SYNC_FAILURE_RETRY_MS = 10 * 60 * 1000
const FULL_RECONCILE_INTERVAL_MS = 5 * 60 * 1000
const IMAP_KEEPALIVE_INTERVAL_MS = 20 * 1000
const EMPTY_MAILBOX_ERROR_RE = /\bno such message\b/i
const MAX_RAW_SOURCE_BYTES = 25 * 1024 * 1024
const condstoreRejected = new WeakSet<ImapFlow>()

async function attachedPublicKeys(
  attachments: Awaited<ReturnType<typeof simpleParser>>['attachments']
): Promise<PublicKey[]> {
  const candidates = (attachments ?? [])
    .filter((attachment) => attachment.content.length <= 2_000_000)
    .flatMap((attachment) => {
      const text = attachment.content.toString('utf8')
      return attachment.contentType === 'application/pgp-keys' ||
        text.includes('BEGIN PGP PUBLIC KEY BLOCK')
        ? [text]
        : []
    })
    .slice(0, 5)
  const keys = await Promise.all(
    candidates.map(async (armoredKey) => {
      try {
        return await readKey({ armoredKey })
      } catch {
        return null
      }
    })
  )
  return keys.filter((key): key is PublicKey => key !== null)
}

async function parseIncomingSource(source: Buffer) {
  const initial = await simpleParser(source)
  const openPgpHint =
    source
      .subarray(0, Math.min(source.length, 256_000))
      .toString('utf8')
      .match(/pgp-|BEGIN PGP /i) ||
    initial.attachments?.some((attachment) => /pgp/i.test(attachment.contentType))
  if (!openPgpHint) {
    return {
      parsed: initial,
      openPgp: {
        signed: false,
        signatureStatus: null,
        signer: null,
        fingerprint: null,
        encrypted: false,
        decrypted: false,
        error: null,
        rawMessage: source
      },
      replaceContent: false
    }
  }
  const [privateKeys, storedVerificationKeys, messageVerificationKeys] = await Promise.all([
    getOpenPgpPrivateKeys(),
    getOpenPgpPublicKeys(),
    attachedPublicKeys(initial.attachments)
  ])
  const verificationKeys = [...storedVerificationKeys, ...messageVerificationKeys]
  const trustedFingerprints = new Set(
    storedVerificationKeys.map((key) => key.getFingerprint().toLowerCase())
  )
  const detachedSignatures = (initial.attachments ?? [])
    .filter(
      (attachment) =>
        attachment.contentType === 'application/pgp-signature' &&
        /^(signature\.asc|message\.(?:asc|sig))$/i.test(attachment.filename ?? '')
    )
    .map((attachment) => attachment.content)
  const senderAddress = parseAddressFields([summarizeAddresses(initial.from)])[0]?.email
  const openPgp = await processInboundOpenPgp({
    raw: source,
    text: initial.text,
    detachedSignatures,
    privateKeys,
    verificationKeys,
    trustedFingerprints,
    senderAddress
  })
  const transformed = !openPgp.rawMessage.equals(source)
  if (!openPgp.decrypted && !transformed) return { parsed: initial, openPgp, replaceContent: false }
  const parsed = await simpleParser(openPgp.rawMessage)
  if (!openPgp.decrypted) return { parsed, openPgp, replaceContent: true }
  const decryptedPublicKeys = await attachedPublicKeys(parsed.attachments)
  if (decryptedPublicKeys.length === 0) return { parsed, openPgp, replaceContent: true }
  const verified = await processInboundOpenPgp({
    raw: source,
    text: initial.text,
    detachedSignatures,
    privateKeys,
    verificationKeys: [...storedVerificationKeys, ...decryptedPublicKeys],
    trustedFingerprints,
    senderAddress
  })
  return { parsed, openPgp: verified, replaceContent: true }
}

async function connectImap(config: ImapConfig, label: string): Promise<ImapFlow> {
  return withRetry(() => getWorkerConnection(config), { label, maxAttempts: 3, baseDelayMs: 2000 })
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
  snoozedUntil?: Date | null
  threadId: string | null
  threadStarred?: boolean
  threadPinned?: boolean
  hasThreadNote?: boolean
  important?: boolean
}

// Joined row returned by detail queries
export type MailRow = MailListRow & {
  textContent: string
  htmlContent: string | null
  replyTo: string | null
  inReplyTo: string | null
  references: string | null
  spfStatus?: string | null
  dkimStatus?: string | null
  dmarcStatus?: string | null
  authservId?: string | null
  authenticationTrusted?: boolean
  rawSourceAvailable?: boolean
  openPgpSigned?: boolean
  openPgpSignatureStatus?: string | null
  openPgpSigner?: string | null
  openPgpFingerprint?: string | null
  openPgpEncrypted?: boolean
  openPgpDecrypted?: boolean
  openPgpError?: string | null
  threadDepth?: number
}

export type ThreadRow = MailListRow & {
  threadCount: number
  hasUnread?: boolean
  hasImportantUnread?: boolean
}

export function normalizeSenderAddress(from: string | null | undefined) {
  if (!from) return ''
  const angleAddress = from.match(/<([^<>]+)>/)?.[1]
  return (angleAddress ?? from).trim().toLowerCase()
}

export type ThreadMetadataFilter = 'starred' | 'pinned'

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
type SyncOptions = {
  beforeMailbox?: () => Promise<void>
  mailboxes?: ReadonlyMap<string, ReadonlySet<string>>
}

// Yield control back to the Node.js event loop so HTTP requests can be served
// between sync chunks during large mailbox backfills.
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

function mailboxFlagsJson(mailboxPath: string, flags: string[]) {
  return JSON.stringify(normalizeMailboxFlags(mailboxPath, flags))
}

function normalizeMailRowFlags<T extends MailListRow>(row: T): T {
  if (!isAlwaysReadMailbox(row.mailbox)) return row

  const flags = JSON.parse(row.flags) as string[]
  const normalizedFlags = ensureSeenFlag(flags)
  if (normalizedFlags === flags) return row

  return { ...row, flags: JSON.stringify(normalizedFlags) } as T
}

let activeSync: Promise<void> | null = null

function summarizeAddresses(input: unknown) {
  if (!input || typeof input !== 'object' || !('value' in input)) return ''
  const addressObject = input as {
    text?: string
    value?: Array<{
      name?: string
      address?: string
      group?: Array<{ name?: string; address?: string }>
    }>
  }

  const addresses = (addressObject.value ?? []).flatMap((entry) => entry.group ?? [entry])
  const formatted = addresses
    .map((entry) => entry.name || entry.address || '')
    .map((entry, index) => {
      const source = addresses[index]
      if (!source?.name || !source.address) return entry
      if (source.name.trim().toLowerCase() === source.address.trim().toLowerCase()) {
        return source.address
      }
      return `${source.name.trim()} <${source.address.trim()}>`
    })
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(', ')

  return formatted || addressObject.text?.trim() || ''
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

function trustedAuthservIds() {
  return (env.MAIL_AUTH_TRUSTED_AUTHSERV_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function isTrustedAuthservId(authservId: string | null | undefined) {
  if (!authservId) return false
  const normalizedId = authservId.trim().toLowerCase()
  return trustedAuthservIds().some((trusted) => {
    const normalized = trusted.toLowerCase()
    return normalized.startsWith('*.')
      ? normalizedId.endsWith(normalized.slice(1))
      : normalizedId === normalized
  })
}

function withAuthenticationTrust<T extends { authservId?: string | null }>(row: T) {
  return { ...row, authenticationTrusted: isTrustedAuthservId(row.authservId) }
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

async function recordRawBackfillFailure(rows: Array<{ id: number; attempts: number }>) {
  for (const row of rows) {
    const attempts = row.attempts + 1
    await db
      .update(mailMessageMailbox)
      .set({
        rawSourceAttempts: attempts,
        rawSourceCheckedAt: attempts >= 3 ? new Date() : null,
        rawSourceNextAttemptAt: attempts >= 3 ? null : new Date(Date.now() + 5 * 60_000)
      })
      .where(and(eq(mailMessageMailbox.id, row.id), isNull(mailMessageMailbox.rawSource)))
  }
}

async function canReplaceMessageContent(messageId: string, source: Buffer) {
  const copies = await db
    .select({ rawSource: mailMessageMailbox.rawSource })
    .from(mailMessageMailbox)
    .where(eq(mailMessageMailbox.messageId, messageId))
  if (copies.length <= 1) return true
  return copies.every(
    (copy) => copy.rawSource !== null && Buffer.from(copy.rawSource).equals(source)
  )
}

export async function backfillOpenPgpFromWorker() {
  if (isDemoModeEnabled()) return 0
  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      messageId: mailMessageMailbox.messageId,
      rawSource: mailMessageMailbox.rawSource
    })
    .from(mailMessageMailbox)
    .where(
      and(isNotNull(mailMessageMailbox.rawSource), isNull(mailMessageMailbox.openPgpProcessedAt))
    )
    .orderBy(desc(mailMessageMailbox.id))
    .limit(10)

  let processed = 0
  for (const row of rows) {
    if (!row.rawSource) continue
    try {
      const source = Buffer.from(row.rawSource)
      const { parsed, openPgp, replaceContent } = await parseIncomingSource(source)
      if (replaceContent && (await canReplaceMessageContent(row.messageId, source))) {
        await storeMessageContent(row.messageId, parsed, undefined, true)
      }
      await db
        .update(mailMessageMailbox)
        .set({
          openPgpSigned: openPgp.signed,
          openPgpSignatureStatus: openPgp.signatureStatus,
          openPgpSigner: openPgp.signer,
          openPgpFingerprint: openPgp.fingerprint,
          openPgpEncrypted: openPgp.encrypted,
          openPgpDecrypted: openPgp.decrypted,
          openPgpError: openPgp.error,
          openPgpProcessedAt: new Date()
        })
        .where(eq(mailMessageMailbox.id, row.id))
      processed += 1
    } catch (error) {
      logServerError('mail.openpgp.backfill', error, { mailboxEntryId: row.id })
      await db
        .update(mailMessageMailbox)
        .set({
          openPgpError: error instanceof Error ? error.message : String(error),
          openPgpProcessedAt: new Date()
        })
        .where(eq(mailMessageMailbox.id, row.id))
    }
  }
  return processed
}

export async function backfillMailAuthenticationFromWorker() {
  if (isDemoModeEnabled()) return 0
  const [configs, pending] = await Promise.all([
    getImapConfigs(),
    db
      .select({
        id: mailMessageMailbox.id,
        messageId: mailMessageMailbox.messageId,
        mailbox: mailMessageMailbox.mailbox,
        uid: mailMessageMailbox.uid,
        uidValidity: mailMessageMailbox.uidValidity,
        attempts: mailMessageMailbox.rawSourceAttempts,
        configId: mailboxCatalog.configId,
        remoteMailbox: mailboxCatalog.remotePath
      })
      .from(mailMessageMailbox)
      .innerJoin(mailboxCatalog, eq(mailboxCatalog.path, mailMessageMailbox.mailbox))
      .where(
        and(
          isNull(mailMessageMailbox.rawSource),
          isNull(mailMessageMailbox.rawSourceCheckedAt),
          isNotNull(mailboxCatalog.configId),
          isNotNull(mailboxCatalog.remotePath),
          or(
            isNull(mailMessageMailbox.rawSourceNextAttemptAt),
            lte(mailMessageMailbox.rawSourceNextAttemptAt, new Date())
          )
        )
      )
      .orderBy(desc(mailMessageMailbox.id))
      .limit(10)
  ])
  if (pending.length === 0 || configs.length === 0) return 0

  const groups = new Map<
    string,
    { config: ImapConfig; remoteMailbox: string; rows: typeof pending }
  >()
  for (const row of pending) {
    const config = configs.find((candidate) => candidate.id === row.configId)
    if (!config || !row.remoteMailbox) {
      await recordRawBackfillFailure([row])
      continue
    }
    const key = `${config.id}\0${row.remoteMailbox}`
    const group = groups.get(key) ?? { config, remoteMailbox: row.remoteMailbox, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }

  let stored = 0
  for (const group of groups.values()) {
    let attemptedRows = group.rows
    try {
      const connection = await connectImap(group.config, `${group.remoteMailbox} raw backfill`)
      await connection.mailboxOpen(group.remoteMailbox)
      const openedUidValidity = connection.mailbox ? Number(connection.mailbox.uidValidity) : null
      const validRows = group.rows.filter(
        (row) => row.uidValidity !== null && row.uidValidity === openedUidValidity
      )
      const invalidRows = group.rows.filter((row) => !validRows.includes(row))
      if (invalidRows.length > 0) await recordRawBackfillFailure(invalidRows)
      if (validRows.length === 0) continue
      attemptedRows = validRows

      const rowByUid = new Map(validRows.map((row) => [row.uid, row]))
      const returnedUids = new Set<number>()
      for await (const item of connection.fetch(
        validRows.map((row) => row.uid).join(','),
        { uid: true, source: true },
        { uid: true }
      )) {
        if (!item.uid) continue
        const row = rowByUid.get(item.uid)
        if (!row) continue
        returnedUids.add(item.uid)
        if (!item.source) {
          await db
            .update(mailMessageMailbox)
            .set({ rawSourceCheckedAt: new Date() })
            .where(eq(mailMessageMailbox.id, row.id))
          continue
        }
        if (item.source.length > MAX_RAW_SOURCE_BYTES) {
          await db
            .update(mailMessageMailbox)
            .set({ rawSourceCheckedAt: new Date() })
            .where(eq(mailMessageMailbox.id, row.id))
          continue
        }

        let authentication = parseMailAuthentication([])
        try {
          const { parsed, openPgp, replaceContent } = await parseIncomingSource(item.source)
          authentication = parseMailAuthentication(parsed.headerLines ?? [])
          if (replaceContent && (await canReplaceMessageContent(row.messageId, item.source))) {
            await storeMessageContent(row.messageId, parsed, undefined, true)
          }
          await db
            .update(mailMessageMailbox)
            .set({
              openPgpSigned: openPgp.signed,
              openPgpSignatureStatus: openPgp.signatureStatus,
              openPgpSigner: openPgp.signer,
              openPgpFingerprint: openPgp.fingerprint,
              openPgpEncrypted: openPgp.encrypted,
              openPgpDecrypted: openPgp.decrypted,
              openPgpError: openPgp.error,
              openPgpProcessedAt: new Date()
            })
            .where(eq(mailMessageMailbox.id, row.id))
        } catch (error) {
          logServerError('mail.raw-source.parse-authentication', error, {
            mailbox: row.mailbox,
            uid: row.uid
          })
        }

        await db
          .update(mailMessageMailbox)
          .set({
            rawSource: item.source,
            rawSourceCheckedAt: new Date(),
            rawSourceNextAttemptAt: null,
            spfStatus: authentication.spfStatus,
            dkimStatus: authentication.dkimStatus,
            dmarcStatus: authentication.dmarcStatus,
            authservId: authentication.authservId
          })
          .where(and(eq(mailMessageMailbox.id, row.id), isNull(mailMessageMailbox.rawSource)))
        stored += 1
      }

      const unavailableIds = validRows
        .filter((row) => !returnedUids.has(row.uid))
        .map((row) => row.id)
      if (unavailableIds.length > 0) {
        await db
          .update(mailMessageMailbox)
          .set({ rawSourceCheckedAt: new Date() })
          .where(inArray(mailMessageMailbox.id, unavailableIds))
      }
    } catch (error) {
      logServerError('mail.raw-source.backfill', error, {
        configId: group.config.id,
        mailbox: group.remoteMailbox
      })
      await recordRawBackfillFailure(attemptedRows)
    }
  }
  return stored
}

function fallbackMailboxName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
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

function localMailboxPath(config: ImapConfig, remotePath: string) {
  return config.id === 'primary' ? remotePath : `${config.name}/${remotePath}`
}

async function readMailboxCatalogRows(): Promise<ImapMailbox[]> {
  const rows = await db
    .select({
      path: mailboxCatalog.path,
      configId: mailboxCatalog.configId,
      remotePath: mailboxCatalog.remotePath,
      name: mailboxCatalog.name,
      delimiter: mailboxCatalog.delimiter,
      specialUse: mailboxCatalog.specialUse
    })
    .from(mailboxCatalog)
    .orderBy(asc(mailboxCatalog.path))

  if (rows.length > 0) {
    return sortImapMailboxes(
      rows.map((row) => ({
        path: row.path,
        configId: row.configId,
        remotePath: row.remotePath,
        name: row.name,
        delimiter: row.delimiter,
        specialUse: row.specialUse
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
      delimiter: '/',
      specialUse: null
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
        row?.path === next?.path &&
        row?.configId === next?.configId &&
        row?.remotePath === next?.remotePath &&
        row?.name === next?.name &&
        row?.delimiter === next?.delimiter &&
        row?.specialUse === next?.specialUse
      )
    })
  ) {
    return
  }

  const now = new Date()
  if (mailboxes.length > 0) {
    for (const mailbox of mailboxes) {
      await db
        .insert(mailboxCatalog)
        .values({
          path: mailbox.path,
          configId: mailbox.configId ?? null,
          remotePath: mailbox.remotePath ?? null,
          name: mailbox.name,
          delimiter: mailbox.delimiter,
          specialUse: mailbox.specialUse,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: mailboxCatalog.path,
          set: {
            name: mailbox.name,
            configId: mailbox.configId ?? null,
            remotePath: mailbox.remotePath ?? null,
            delimiter: mailbox.delimiter,
            specialUse: mailbox.specialUse,
            updatedAt: now
          }
        })
    }
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
  const candidates = referenceCandidates({
    messageId: ownId,
    references: references.join(' '),
    inReplyTo
  })
  if (candidates.length === 0) return ownId
  const existing = await db
    .select({ messageId: mailMessage.messageId, threadKey: mailMessage.threadKey })
    .from(mailMessage)
    .where(inArray(mailMessage.messageId, candidates))
  const existingById = new Map(existing.map((message) => [message.messageId, message.threadKey]))
  const resolved = existingById.get(candidates[0]!) ?? candidates[0]!
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
  internalDate?: Date,
  replaceContent = false
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
  const from = sanitizePgText(summarizeAddresses(message.from))
  const to = sanitizePgText(summarizeAddresses(message.to))
  const replyTo = sanitizeNullablePgText(
    summarizeAddresses(message.replyTo as Parameters<typeof summarizeAddresses>[0]) || null
  )

  // Resolve thread key
  const refList = references ? references.split(/\s+/).filter(Boolean) : []
  const threadKey = await resolveThreadKey(refList, inReplyTo, sanitizedMessageId)

  const result = await db
    .insert(mailMessage)
    .values({
      messageId: sanitizedMessageId,
      subject: sanitizePgText(message.subject?.trim() ?? '(no subject)'),
      from,
      to,
      cc,
      replyTo,
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

  if (!isNew && replaceContent) {
    await db.transaction(async (tx) => {
      await tx
        .update(mailMessage)
        .set({ preview: createPreview(textContent), textContent, htmlContent })
        .where(eq(mailMessage.messageId, sanitizedMessageId))
      await tx.delete(mailAttachment).where(eq(mailAttachment.messageId, sanitizedMessageId))
      for (const attachment of message.attachments ?? []) {
        if (attachment.contentDisposition === 'inline' || !attachment.content) continue
        await tx.insert(mailAttachment).values({
          messageId: sanitizedMessageId,
          filename: sanitizePgText(attachment.filename ?? 'attachment'),
          contentType: sanitizePgText(attachment.contentType ?? 'application/octet-stream'),
          size: attachment.size ?? attachment.content.length,
          content: attachment.content
        })
      }
    })
  }

  if (isNew) {
    await upsertContacts(
      parseAddressFields([from, to, cc, replyTo]).map((contact) => ({
        ...contact,
        source: 'auto' as const,
        useCount: 1,
        lastUsedAt: receivedAt
      }))
    )
  }

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
  uidValidity: number | null,
  flags: string[],
  receivedAt?: Date | null,
  security?: {
    rawSource: Buffer | null
    spfStatus: string | null
    dkimStatus: string | null
    dmarcStatus: string | null
    authservId: string | null
    openPgp?: OpenPgpSecurityResult
  }
) {
  const startedAt = Date.now()
  const sanitizedMessageId = sanitizePgText(effectiveMessageId)
  const sanitizedMailbox = sanitizePgText(mailbox)
  const securityValues = security
    ? {
        rawSource: security.rawSource,
        spfStatus: security.spfStatus,
        dkimStatus: security.dkimStatus,
        dmarcStatus: security.dmarcStatus,
        authservId: security.authservId,
        openPgpSigned: security.openPgp?.signed ?? false,
        openPgpSignatureStatus: security.openPgp?.signatureStatus ?? null,
        openPgpSigner: security.openPgp?.signer ?? null,
        openPgpFingerprint: security.openPgp?.fingerprint ?? null,
        openPgpEncrypted: security.openPgp?.encrypted ?? false,
        openPgpDecrypted: security.openPgp?.decrypted ?? false,
        openPgpError: security.openPgp?.error ?? null,
        openPgpProcessedAt: new Date(),
        rawSourceCheckedAt: new Date()
      }
    : {}
  await db
    .insert(mailMessageMailbox)
    .values({
      messageId: sanitizedMessageId,
      mailbox: sanitizedMailbox,
      uid,
      uidValidity,
      flags: mailboxFlagsJson(sanitizedMailbox, flags),
      ...securityValues,
      receivedAt: receivedAt ?? null,
      syncedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
      set: {
        messageId: sanitizedMessageId,
        uidValidity,
        flags: mailboxFlagsJson(sanitizedMailbox, flags),
        ...securityValues,
        receivedAt: receivedAt ?? null,
        syncedAt: new Date()
      }
    })

  const ms = Date.now() - startedAt
  if (ms >= 100) {
    console.log(`[sync] ${mailbox}: storeMailboxEntry uid=${uid} ${ms}ms`)
  }
}

async function resetMailboxForUidValidity(mailbox: string) {
  await db.transaction(async (tx) => {
    await tx.delete(mailThreadSummary).where(eq(mailThreadSummary.mailbox, mailbox))
    await tx.delete(mailMessageMailbox).where(eq(mailMessageMailbox.mailbox, mailbox))
    await tx
      .delete(imapJob)
      .where(and(eq(imapJob.mailbox, mailbox), ne(imapJob.type, 'append_draft')))
  })
}

async function reconcileMailbox(client: ImapFlow, mailbox: string, changedSince?: bigint) {
  const reconciliationStartedAt = new Date()
  const searchResult = await client.search({ all: true }, { uid: true })
  if (searchResult === false) throw new Error(`UID SEARCH failed for ${mailbox}`)
  const remoteUids = searchResult
  const remoteUidSet = new Set(remoteUids)
  const remoteFlags = new Map<number, string>()
  let requestCount = 1

  const remoteUidRange = uidFetchRange(remoteUids)
  if (remoteUidRange) {
    for await (const item of client.fetch(
      remoteUidRange,
      { uid: true, flags: true },
      { uid: true, changedSince }
    )) {
      if (!item.uid) continue
      remoteFlags.set(item.uid, mailboxFlagsJson(mailbox, Array.from(item.flags ?? []).map(String)))
    }
    requestCount += 1
  }

  // Read jobs remain durable until this snapshot confirms their remote flags.
  const [localRows, activeJobs] = await Promise.all([
    db
      .select({
        id: mailMessageMailbox.id,
        uid: mailMessageMailbox.uid,
        flags: mailMessageMailbox.flags,
        threadKey: mailMessage.threadKey
      })
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(eq(mailMessageMailbox.mailbox, mailbox)),
    db
      .select({
        id: imapJob.id,
        uid: imapJob.uid,
        type: imapJob.type,
        status: imapJob.status
      })
      .from(imapJob)
      .where(
        and(
          eq(imapJob.mailbox, mailbox),
          or(
            eq(imapJob.status, 'pending'),
            eq(imapJob.status, 'running'),
            gte(imapJob.updatedAt, reconciliationStartedAt),
            and(
              eq(imapJob.status, 'done'),
              or(eq(imapJob.type, 'mark_read'), eq(imapJob.type, 'mark_unread'))
            )
          )
        )
      )
  ])

  const completedSeenJobs = activeJobs.filter(
    (job) => job.status === 'done' && (job.type === 'mark_read' || job.type === 'mark_unread')
  )
  const unconfirmedUids = [
    ...new Set(
      completedSeenJobs
        .map((job) => job.uid)
        .filter(
          (uid): uid is number => uid !== null && remoteUidSet.has(uid) && !remoteFlags.has(uid)
        )
    )
  ]
  const unconfirmedUidRange = uidFetchRange(unconfirmedUids)
  if (unconfirmedUidRange) {
    for await (const item of client.fetch(
      unconfirmedUidRange,
      { uid: true, flags: true },
      { uid: true }
    )) {
      if (!item.uid) continue
      remoteFlags.set(item.uid, mailboxFlagsJson(mailbox, Array.from(item.flags ?? []).map(String)))
    }
    requestCount += 1
  }

  const protectedUids = new Set<number>()
  for (const job of activeJobs) {
    if (job.uid === null) continue
    if (job.status !== 'done' || (job.type !== 'mark_read' && job.type !== 'mark_unread')) {
      protectedUids.add(job.uid)
      continue
    }

    if (!remoteUidSet.has(job.uid)) {
      await db
        .delete(imapJob)
        .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'done'), eq(imapJob.type, job.type)))
      continue
    }

    const flags = remoteFlags.get(job.uid)
    if (flags !== undefined && seenJobMatchesFlags(job.type, flags)) {
      await db
        .delete(imapJob)
        .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'done'), eq(imapJob.type, job.type)))
      continue
    }

    protectedUids.add(job.uid)
    if (flags !== undefined) {
      const now = new Date()
      await db
        .update(imapJob)
        .set({
          status: 'pending',
          attemptCount: 0,
          availableAt: now,
          lastError: null,
          updatedAt: now
        })
        .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'done'), eq(imapJob.type, job.type)))
    }
  }

  const removedThreadKeys = new Set<string>()
  const readNotificationIds: number[] = []

  for (const change of reconcileMailboxRows(localRows, remoteUidSet, remoteFlags, protectedUids)) {
    if (change.action === 'delete') {
      await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, change.row.id))
      removedThreadKeys.add(change.row.threadKey)
    } else {
      const updated = await db
        .update(mailMessageMailbox)
        .set({ flags: change.flags, syncedAt: new Date() })
        .where(
          and(
            eq(mailMessageMailbox.id, change.row.id),
            eq(mailMessageMailbox.flags, change.row.flags)
          )
        )
        .returning({ id: mailMessageMailbox.id })
      if (updated.length > 0 && !isSeenFlags(change.row.flags) && isSeenFlags(change.flags)) {
        readNotificationIds.push(change.row.id)
      }
    }
  }

  await dismissReadNotifications(readNotificationIds)
  await refreshThreadSummaries(mailbox, removedThreadKeys)
  return requestCount
}

async function dismissReadNotifications(messageIds: number[]) {
  if (messageIds.length === 0) return
  try {
    const { dismissReadNotifications: sendDismissPush } = await import('./push')
    await sendDismissPush(messageIds)
  } catch (error) {
    logServerError('push.dismissReadNotifications', error, { messageIds })
  }
}

async function reconcileMailboxWithFallback(
  client: ImapFlow,
  mailbox: string,
  changedSince?: bigint
) {
  if (changedSince === undefined || condstoreRejected.has(client)) {
    return reconcileMailbox(client, mailbox)
  }

  try {
    return await reconcileMailbox(client, mailbox, changedSince)
  } catch (error) {
    if (!isCondstoreRejection(error)) throw error
    condstoreRejected.add(client)
    console.warn(`[sync] ${mailbox}: CONDSTORE rejected; falling back to full metadata fetch`)
    return reconcileMailbox(client, mailbox)
  }
}

async function syncOneMailbox(
  config: ImapConfig,
  mailboxPath: string,
  pollMs: number,
  remoteMailboxPath = mailboxPath,
  force = false,
  beforeChunk?: () => Promise<void>
): Promise<boolean> {
  const state = await readSyncState(mailboxPath)
  const historyComplete = state?.historyComplete ?? false
  const previousLastUid = state?.lastUid ?? 0
  let failureLastUid = previousLastUid
  let failureHistoryComplete = historyComplete
  let nextLastUid = previousLastUid
  const lastSyncedAt = state?.lastSyncedAt?.getTime() ?? 0
  const initialSyncFailedBefore =
    !historyComplete && nextLastUid === 0 && Boolean(state?.lastError?.trim())
  const retryDelayMs = initialSyncFailedBefore
    ? Math.max(pollMs, INITIAL_SYNC_FAILURE_RETRY_MS)
    : pollMs

  if (!force && lastSyncedAt && Date.now() - lastSyncedAt < retryDelayMs) return false

  let fetchedCount = 0
  let storedCount = 0
  let storedNewMessage = false
  let requestCount = 0
  const touchedThreadKeys = new Set<string>()

  const t0 = Date.now()
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

  await setSyncProgress(mailboxPath, 0, 0)
  console.log(
    `[sync] ${mailboxPath}: starting (lastUid=${nextLastUid}, historyComplete=${historyComplete})`
  )
  let client: ImapFlow | null = null
  try {
    const syncClient = await connectImap(config, `${mailboxPath} sync`)
    client = syncClient
    console.log(`[sync] ${mailboxPath}: connected (${elapsed()})`)
    const status = await syncClient.status(remoteMailboxPath, {
      messages: true,
      unseen: true,
      uidNext: true,
      uidValidity: true,
      highestModseq: true
    })
    requestCount += 1
    let lastImapActivityAt = Date.now()
    const keepImapAlive = async () => {
      const now = Date.now()
      if (!imapKeepaliveDue(lastImapActivityAt, now, IMAP_KEEPALIVE_INTERVAL_MS)) return
      await syncClient.noop()
      requestCount += 1
      lastImapActivityAt = Date.now()
    }
    const reconciliationFresh =
      Date.now() - (state?.lastReconciledAt?.getTime() ?? 0) < FULL_RECONCILE_INTERVAL_MS
    if (
      state &&
      shouldUseStatusFastPath(
        force,
        reconciliationFresh,
        {
          lastUid: state.lastUid,
          uidValidity: state.uidValidity,
          highestModseq: state.highestModseq
        },
        status
      )
    ) {
      await saveSyncState(mailboxPath, {
        lastFetchedCount: 0,
        lastStoredCount: 0,
        lastSyncedAt: new Date(),
        lastError: null
      })
      console.log(`[sync] ${mailboxPath}: STATUS unchanged requests=${requestCount} (${elapsed()})`)
      return false
    }
    const lock = await syncClient.getMailboxLock(remoteMailboxPath)
    lastImapActivityAt = Date.now()
    let uidValidity: number | null = null
    let highestModseq: bigint | null = null
    try {
      if (!syncClient.mailbox) throw new Error(`Mailbox ${remoteMailboxPath} was not selected`)
      uidValidity = Number(syncClient.mailbox.uidValidity)
      highestModseq = syncClient.mailbox.highestModseq ?? null
      const uidNext = syncClient.mailbox.uidNext

      if (uidValidityChanged(state?.uidValidity ?? null, uidValidity)) {
        console.warn(`[sync] ${mailboxPath}: UIDVALIDITY changed; resetting mailbox cache`)
        await resetMailboxForUidValidity(mailboxPath)
        nextLastUid = 0
        failureLastUid = 0
        failureHistoryComplete = false
      }

      const range = newUidRange(nextLastUid, uidNext)
      const fetchOptions = { uid: true }

      console.log(
        `[sync] ${mailboxPath}: fetching envelopes range=${range ?? 'none'} (${elapsed()})`
      )

      // Phase 1: fetch lightweight envelopes to discover message-ids
      type EnvelopeItem = {
        uid: number
        effectiveMessageId: string
        flags: string[]
        internalDate: Date | undefined
      }
      const envelopeItems: EnvelopeItem[] = []

      if (range) {
        requestCount += 1
        for await (const item of syncClient.fetch(
          range,
          { uid: true, envelope: true, flags: true, internalDate: true },
          fetchOptions
        )) {
          if (!item.uid) continue
          const msgId = sanitizePgText(
            (item.envelope as { messageId?: string } | undefined)?.messageId?.trim() ?? ''
          )
          const effectiveMessageId = msgId || `synthetic:${sanitizePgText(mailboxPath)}:${item.uid}`
          const flags = normalizeMailboxFlags(mailboxPath, Array.from(item.flags ?? []).map(String))
          const internalDate =
            item.internalDate instanceof Date
              ? item.internalDate
              : typeof item.internalDate === 'string'
                ? new Date(item.internalDate)
                : undefined

          envelopeItems.push({ uid: item.uid, effectiveMessageId, flags, internalDate })
          fetchedCount += 1
          if (fetchedCount % 1000 === 0) {
            console.log(
              `[sync] ${mailboxPath}: envelopes fetched ${fetchedCount}... (${elapsed()})`
            )
          }
        }
        lastImapActivityAt = Date.now()
      }

      nextLastUid = uidNext - 1

      console.log(
        `[sync] ${mailboxPath}: envelope fetch complete — ${fetchedCount} messages (${elapsed()})`
      )

      if (envelopeItems.length === 0) {
        console.log(`[sync] ${mailboxPath}: no new messages`)
      } else {
        // Phase 2: check which message-ids we already have content for
        console.log(`[sync] ${mailboxPath}: checking cache for ${fetchedCount} message-ids...`)
        const allMessageIds = envelopeItems.map((i) => i.effectiveMessageId)
        const [existingRows, existingMailboxRows] = await Promise.all([
          db
            .select({ messageId: mailMessage.messageId, threadKey: mailMessage.threadKey })
            .from(mailMessage)
            .where(inArray(mailMessage.messageId, allMessageIds)),
          db
            .select({
              uid: mailMessageMailbox.uid,
              rawStored: sql<boolean>`${mailMessageMailbox.rawSource} is not null`
            })
            .from(mailMessageMailbox)
            .where(
              and(
                eq(mailMessageMailbox.mailbox, mailboxPath),
                inArray(
                  mailMessageMailbox.uid,
                  envelopeItems.map((item) => item.uid)
                )
              )
            )
        ])

        const existingThreadKeyById = new Map(
          existingRows.map((row) => [row.messageId, row.threadKey])
        )
        const cachedSourceUids = new Set(
          existingMailboxRows.filter((row) => row.rawStored).map((row) => row.uid)
        )
        const needsSourceItems = envelopeItems.filter((item) => !cachedSourceUids.has(item.uid))
        const cachedItems = envelopeItems.filter((item) => cachedSourceUids.has(item.uid))
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

        // Phase 3a: finish remote reads before potentially long local cache updates.
        const newlyStoredMessageIds: string[] = []
        if (needsSourceItems.length > 0) {
          const BATCH_SIZE = 150
          // Sort descending so batches go from highest UID (newest) to lowest (oldest)
          const byNewest = [...needsSourceItems].sort((a, b) => b.uid - a.uid)

          for (let batchStart = 0; batchStart < byNewest.length; batchStart += BATCH_SIZE) {
            await keepImapAlive()
            await beforeChunk?.()
            const batch = byNewest.slice(batchStart, batchStart + BATCH_SIZE)
            const itemByUid = new Map(batch.map((i) => [i.uid, i]))

            requestCount += 1
            for await (const fetchItem of syncClient.fetch(
              batch.map((i) => i.uid).join(','),
              { uid: true, source: true },
              { uid: true }
            )) {
              if (!fetchItem.uid || !fetchItem.source) continue
              const item = itemByUid.get(fetchItem.uid)
              if (!item) continue
              const { parsed, openPgp } = await parseIncomingSource(fetchItem.source)
              const authentication = parseMailAuthentication(parsed.headerLines ?? [])
              const storedMessage = await storeMessageContent(
                item.effectiveMessageId,
                parsed,
                item.internalDate
              )
              if (storedMessage.isNew) {
                newlyStoredMessageIds.push(item.effectiveMessageId)
                storedNewMessage = true
              }
              touchedThreadKeys.add(storedMessage.threadKey)
              await storeMailboxEntry(
                item.effectiveMessageId,
                mailboxPath,
                item.uid,
                uidValidity,
                item.flags,
                item.internalDate,
                {
                  rawSource:
                    fetchItem.source.length <= MAX_RAW_SOURCE_BYTES ? fetchItem.source : null,
                  spfStatus: authentication.spfStatus,
                  dkimStatus: authentication.dkimStatus,
                  dmarcStatus: authentication.dmarcStatus,
                  authservId: authentication.authservId,
                  openPgp
                }
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
            lastImapActivityAt = Date.now()
            // Yield between batches so HTTP requests can be served
            await yieldToEventLoop()
          }
        }

        // Phase 3b: update mailbox entries for already-cached messages.
        if (cachedItems.length > 0) {
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
                  uidValidity,
                  flags: mailboxFlagsJson(mailboxPath, item.flags),
                  receivedAt: item.internalDate ?? null,
                  syncedAt: new Date()
                })
                .onConflictDoUpdate({
                  target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
                  set: {
                    messageId: item.effectiveMessageId,
                    uidValidity,
                    flags: mailboxFlagsJson(mailboxPath, item.flags),
                    receivedAt: item.internalDate ?? null,
                    syncedAt: new Date()
                  }
                })
              touchedThreadKeys.add(existingThreadKeyById.get(item.effectiveMessageId)!)
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

        if (!syncBatchComplete(fetchedCount, storedCount)) {
          throw new Error(
            `Incomplete mailbox batch: stored ${storedCount} of ${fetchedCount} fetched messages`
          )
        }

        // Send push notifications for new messages
        if (newlyStoredMessageIds.length > 0 && !isAlwaysReadMailbox(mailboxPath)) {
          try {
            const { shouldSendMailboxNotifications } = await import('./mailbox-notifications')
            const shouldNotifyMailbox = await shouldSendMailboxNotifications(mailboxPath)

            if (shouldNotifyMailbox) {
              const { sendPushToAll } = await import('./push')
              const newMsgs = await db
                .select({
                  id: mailMessageMailbox.id,
                  subject: mailMessage.subject,
                  from: mailMessage.from
                })
                .from(mailMessageMailbox)
                .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
                .where(
                  and(
                    eq(mailMessageMailbox.mailbox, mailboxPath),
                    notLike(mailMessageMailbox.flags, '%\\\\Seen%'),
                    inArray(mailMessage.messageId, newlyStoredMessageIds)
                  )
                )
                .limit(5)
              const [unreadRow] = await db
                .select({ count: sql<number>`count(distinct ${mailMessage.threadKey})` })
                .from(mailMessageMailbox)
                .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
                .where(
                  and(
                    eq(mailMessageMailbox.mailbox, mailboxPath),
                    notLike(mailMessageMailbox.flags, '%\\\\Seen%')
                  )
                )
              const unreadCount = Number(unreadRow?.count ?? 0)
              for (const msg of newMsgs) {
                const senderMatch = msg.from?.match(/^([^<]+)</)
                const sender = senderMatch ? senderMatch[1].trim() : (msg.from ?? 'Unknown')
                await sendPushToAll({
                  title: msg.subject ?? '(no subject)',
                  body: `From: ${sender}`,
                  url: `/${pathToSlug(mailboxPath)}/${msg.id}`,
                  messageId: msg.id,
                  unreadCount
                })
              }
            }
          } catch {
            // push is optional — never fail sync
          }
        }
      }
    } finally {
      lock.release()
    }

    // Keep the IMAP session open to reuse it for reconciliation and other mailboxes.
    // Start a background keep-alive to prevent the provider from dropping the session during long local rebuilds.
    const keepaliveTimer = setInterval(() => {
      if (syncClient.usable) {
        syncClient.noop().catch(() => {})
      }
    }, 15_000)

    try {
      await refreshThreadSummaries(mailboxPath, touchedThreadKeys)
    } finally {
      clearInterval(keepaliveTimer)
    }

    const lastReconciledAt = state?.lastReconciledAt?.getTime() ?? 0
    const shouldReconcile = force || Date.now() - lastReconciledAt >= FULL_RECONCILE_INTERVAL_MS
    if (shouldReconcile) {
      const reconcileClient = await connectImap(config, `${mailboxPath} reconcile`)
      client = reconcileClient
      const reconcileLock = await reconcileClient.getMailboxLock(remoteMailboxPath)
      try {
        if (!reconcileClient.mailbox) {
          throw new Error(`Mailbox ${remoteMailboxPath} was not selected for reconciliation`)
        }
        const reconciledUidValidity = Number(reconcileClient.mailbox.uidValidity)
        if (uidValidityChanged(uidValidity, reconciledUidValidity)) {
          throw new Error(`UIDVALIDITY changed while syncing ${mailboxPath}`)
        }
        const changedSince = condstoreChangedSince(
          reconcileClient.capabilities.has('CONDSTORE'),
          condstoreRejected.has(reconcileClient),
          state?.highestModseq ?? null
        )
        requestCount += await reconcileMailboxWithFallback(
          reconcileClient,
          mailboxPath,
          changedSince
        )
        highestModseq = reconcileClient.mailbox.highestModseq ?? null
      } finally {
        reconcileLock.release()
      }
    }

    await saveSyncState(mailboxPath, {
      uidValidity,
      highestModseq,
      lastReconciledAt: shouldReconcile ? new Date() : state?.lastReconciledAt
    })
    failureLastUid = nextLastUid
    failureHistoryComplete = true

    await saveSyncRuntime({ workerHeartbeatAt: new Date() })
    console.log(
      `[sync] ${mailboxPath}: done — ${fetchedCount} fetched, ${storedCount} stored, requests=${requestCount} (${elapsed()})`
    )
    await saveSyncState(mailboxPath, {
      lastUid: nextLastUid,
      historyComplete: true,
      lastFetchedCount: fetchedCount,
      lastStoredCount: storedCount,
      lastSyncedAt: new Date(),
      lastError: null
    })
    return storedNewMessage
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
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
      return false
    }

    console.error(`[sync] ${mailboxPath}: error after ${elapsed()} — ${errorMessage}`)
    await saveSyncState(mailboxPath, {
      lastUid: failureLastUid,
      historyComplete: failureHistoryComplete,
      lastFetchedCount: fetchedCount || (state?.lastFetchedCount ?? 0),
      lastStoredCount: storedCount || (state?.lastStoredCount ?? 0),
      lastSyncedAt: new Date(),
      lastError: errorMessage
    })
    throw error
  } finally {
    // The account worker connection is intentionally kept alive between syncs.
  }
}

async function runSyncAll(config: ImapConfig, options: SyncOptions = {}): Promise<void> {
  const pollMs = config.pollSeconds * 1000
  let listed: {
    path: string
    name: string
    delimiter?: string
    flags?: Set<string>
    specialUse?: string
  }[]

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
        path: localMailboxPath(config, mb.path),
        configId: config.id,
        remotePath: mb.path,
        name: mb.name,
        delimiter: mb.delimiter ?? '/',
        specialUse: mb.specialUse ?? null
      }))
      await replaceMailboxCatalog(cachedMailboxes)
      const selectable = listed.filter((mb) => !mb.flags?.has('\\Noselect'))
      console.log(
        `[sync] found ${listed.length} mailboxes (${selectable.length} selectable): ${selectable.map((mb) => mb.path).join(', ')}`
      )
    } catch (error) {
      if (listClient) invalidateWorkerConnection(config.id, listClient)
      throw error
    }

    let storedNewMessages = false
    const requestedMailboxes = options.mailboxes?.get(config.id)
    for (const mb of sortImapMailboxes(listed)) {
      if (mb.flags?.has('\\Noselect')) continue
      if (requestedMailboxes && !requestedMailboxes.has(mb.path)) continue
      await options.beforeMailbox?.()
      storedNewMessages =
        (await syncOneMailbox(
          config,
          localMailboxPath(config, mb.path),
          pollMs,
          mb.path,
          requestedMailboxes?.has(mb.path) ?? false,
          options.beforeMailbox
        )) || storedNewMessages
    }

    if (storedNewMessages) await repairThreadKeys()

    console.log(`[sync] all mailboxes done`)
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

export async function getMailboxSyncPollMs() {
  if (isDemoModeEnabled()) return null
  const configs = await getImapConfigs()
  if (configs.length === 0) return null
  return Math.min(...configs.map((config) => config.pollSeconds)) * 1000
}

export async function runMailboxSyncOnce(options: SyncOptions = {}) {
  if (isDemoModeEnabled()) return false
  const configs = await getImapConfigs()
  if (configs.length === 0) return false
  if (!activeSync) {
    activeSync = (async () => {
      for (const config of configs) {
        if (options.mailboxes && !options.mailboxes.has(config.id)) continue
        await runSyncAll(config, options)
      }
    })().finally(() => {
      activeSync = null
    })
  }
  await activeSync
  return true
}

export async function getSyncSummary(): Promise<{
  syncing: boolean
  configured: boolean
  hasError: boolean
  lastSyncedAt: string | null
  errorMessage: string | null
  progress: { mailbox: string; stored: number; total: number } | null
}> {
  if (isDemoModeEnabled()) return getDemoSyncSummary()
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
  if (isDemoModeEnabled()) return getDemoMailboxSyncStatus(mailboxPath)
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
  configId?: string | null
  remotePath?: string | null
  name: string
  delimiter: string
  specialUse?: string | null
}

let cachedMailboxes: ImapMailbox[] | null = null

export function listImapMailboxes(): ImapMailbox[] {
  return cachedMailboxes ?? []
}

export async function getImapMailboxes(options?: {
  waitForCache?: boolean
}): Promise<ImapMailbox[]> {
  if (isDemoModeEnabled()) return getDemoImapMailboxes()
  const rows = await readMailboxCatalogRows()
  cachedMailboxes = rows
  void options
  return rows
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
  snoozedUntil: mailMessageMailbox.snoozedUntil,
  threadId: mailMessage.threadKey,
  important: mailMessage.aiImportant,
  threadStarred: sql<boolean>`exists (
    select 1
    from mail_thread_metadata
    where mail_thread_metadata.mailbox = ${mailMessageMailbox.mailbox}
    and mail_thread_metadata.thread_key = ${mailMessage.threadKey}
    and mail_thread_metadata.starred = true
  )`,
  threadPinned: sql<boolean>`exists (
      select 1
      from mail_thread_metadata
      where mail_thread_metadata.mailbox = ${mailMessageMailbox.mailbox}
      and mail_thread_metadata.thread_key = ${mailMessage.threadKey}
      and mail_thread_metadata.pinned = true
    )`,
  hasThreadNote: sql<boolean>`exists (
    select 1
    from ${mailThreadNote}
    where ${mailThreadNote.threadKey} = ${mailMessage.threadKey}
    and length(trim(${mailThreadNote.body})) > 0
  )`
}

function threadMetadataWhere(mailboxPath: string, filter?: ThreadMetadataFilter) {
  if (!filter) return eq(mailMessageMailbox.mailbox, mailboxPath)

  return and(
    eq(mailMessageMailbox.mailbox, mailboxPath),
    sql`exists (
      select 1
      from mail_thread_metadata
      where mail_thread_metadata.mailbox = ${mailMessageMailbox.mailbox}
      and mail_thread_metadata.thread_key = ${mailMessage.threadKey}
      and ${filter === 'starred' ? sql`mail_thread_metadata.starred = true` : sql`mail_thread_metadata.pinned = true`}
    )`
  )
}

function threadSummaryMetadataWhere(mailboxPath: string, filter?: ThreadMetadataFilter) {
  if (!filter) return eq(mailThreadSummary.mailbox, mailboxPath)

  return and(
    eq(mailThreadSummary.mailbox, mailboxPath),
    sql`exists (
      select 1
      from mail_thread_metadata
      where mail_thread_metadata.mailbox = ${mailThreadSummary.mailbox}
      and mail_thread_metadata.thread_key = ${mailThreadSummary.threadKey}
      and ${filter === 'starred' ? sql`mail_thread_metadata.starred = true` : sql`mail_thread_metadata.pinned = true`}
    )`
  )
}

function activeSnoozeCondition() {
  return or(
    isNull(mailMessageMailbox.snoozedUntil),
    lte(mailMessageMailbox.snoozedUntil, new Date())
  )
}

function noPendingMoveCondition() {
  return sql`not exists (
    select 1
    from imap_job as pending_move
    where pending_move.type = 'move'
    and pending_move.mailbox = ${mailMessageMailbox.mailbox}
    and pending_move.uid = ${mailMessageMailbox.uid}
    and pending_move.status in ('pending', 'running')
  )`
}

const detailSelect = {
  ...listSelect,
  textContent: mailMessage.textContent,
  htmlContent: mailMessage.htmlContent,
  replyTo: mailMessage.replyTo,
  inReplyTo: mailMessage.inReplyTo,
  references: mailMessage.references,
  spfStatus: mailMessageMailbox.spfStatus,
  dkimStatus: mailMessageMailbox.dkimStatus,
  dmarcStatus: mailMessageMailbox.dmarcStatus,
  authservId: mailMessageMailbox.authservId,
  openPgpSigned: mailMessageMailbox.openPgpSigned,
  openPgpSignatureStatus: mailMessageMailbox.openPgpSignatureStatus,
  openPgpSigner: mailMessageMailbox.openPgpSigner,
  openPgpFingerprint: mailMessageMailbox.openPgpFingerprint,
  openPgpEncrypted: mailMessageMailbox.openPgpEncrypted,
  openPgpDecrypted: mailMessageMailbox.openPgpDecrypted,
  openPgpError: mailMessageMailbox.openPgpError,
  rawSourceAvailable: sql<boolean>`${mailMessageMailbox.rawSource} is not null`
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

export async function getThreadMetadata(mailbox: string, threadKey: string) {
  if (isDemoModeEnabled()) return { starred: false, pinned: false }

  const [row] = await db
    .select({ starred: mailThreadMetadata.starred, pinned: mailThreadMetadata.pinned })
    .from(mailThreadMetadata)
    .where(
      and(eq(mailThreadMetadata.mailbox, mailbox), eq(mailThreadMetadata.threadKey, threadKey))
    )
    .limit(1)

  return { starred: row?.starred ?? false, pinned: row?.pinned ?? false }
}

export async function setThreadMetadata(
  mailbox: string,
  threadKey: string,
  values: { starred?: boolean; pinned?: boolean }
) {
  if (isDemoModeEnabled())
    return { starred: values.starred ?? false, pinned: values.pinned ?? false }

  const current = await getThreadMetadata(mailbox, threadKey)
  const next = {
    starred: values.starred ?? current.starred,
    pinned: values.pinned ?? current.pinned
  }

  await db
    .insert(mailThreadMetadata)
    .values({ mailbox, threadKey, ...next })
    .onConflictDoUpdate({
      target: [mailThreadMetadata.mailbox, mailThreadMetadata.threadKey],
      set: { ...next, updatedAt: new Date() }
    })

  return next
}

export async function repairThreadKeys() {
  const startedAt = Date.now()
  const messages = await db
    .select({
      messageId: mailMessage.messageId,
      subject: mailMessage.subject,
      inReplyTo: mailMessage.inReplyTo,
      references: mailMessage.references,
      threadKey: mailMessage.threadKey,
      receivedAt: mailMessage.receivedAt
    })
    .from(mailMessage)

  const assigned = assignThreadKeys(messages)
  const changes = messages
    .map((message) => ({ message, nextThreadKey: assigned.get(message.messageId)! }))
    .filter(({ message, nextThreadKey }) => message.threadKey !== nextThreadKey)

  if (changes.length === 0) return

  await client.begin(async (tx) => {
    await tx`
      create temp table thread_repair (
        message_id text primary key,
        next_thread_key text not null
      ) on commit drop
    `

    for (let index = 0; index < changes.length; index += 1000) {
      const batch = changes.slice(index, index + 1000).map(({ message, nextThreadKey }) => ({
        message_id: message.messageId,
        next_thread_key: nextThreadKey
      }))
      await tx`insert into thread_repair ${tx(batch, 'message_id', 'next_thread_key')}`
    }

    await tx`
      update mail_message
      set thread_id = thread_repair.next_thread_key,
          thread_key = thread_repair.next_thread_key
      from thread_repair
      where mail_message.message_id = thread_repair.message_id
    `

    await tx`delete from mail_thread_summary`

    await tx`
      insert into mail_thread_summary (
        mailbox,
        thread_key,
        representative_mailbox_entry_id,
        thread_count,
        latest_uid,
        latest_received_at
      )
      select mailbox, thread_key, id, thread_count, uid, received_at
      from (
        select
          mail_message_mailbox.mailbox as mailbox,
          mail_message.thread_key as thread_key,
          mail_message_mailbox.id as id,
          mail_message_mailbox.uid as uid,
          mail_message_mailbox.received_at as received_at,
          count(*) over (
            partition by mail_message_mailbox.mailbox, mail_message.thread_key
          )::int as thread_count,
          row_number() over (
            partition by mail_message_mailbox.mailbox, mail_message.thread_key
            order by mail_message_mailbox.received_at desc nulls last, mail_message_mailbox.uid desc
          ) as rn
        from mail_message_mailbox
        join mail_message
          on mail_message_mailbox.message_id = mail_message.message_id
      ) ranked
      where rn = 1
    `
  })

  perfLog('mail.repairThreadKeys', {
    messages: messages.length,
    repaired: changes.length,
    ms: perfMs(startedAt)
  })
}

export async function listStoredMessages(
  mailboxPath: string,
  limit = 100,
  offset = 0,
  unreadOnly = false,
  metadataFilter?: ThreadMetadataFilter
) {
  if (isDemoModeEnabled()) {
    if (metadataFilter) return []
    return listDemoStoredMessages(mailboxPath, limit, offset, unreadOnly)
  }
  if (unreadOnly && isAlwaysReadMailbox(mailboxPath)) return []

  const startedAt = perfNow()

  try {
    const whereClause = unreadOnly
      ? and(
          activeSnoozeCondition(),
          noPendingMoveCondition(),
          threadMetadataWhere(mailboxPath, metadataFilter),
          notLike(mailMessageMailbox.flags, '%\\\\Seen%')
        )
      : and(
          activeSnoozeCondition(),
          noPendingMoveCondition(),
          threadMetadataWhere(mailboxPath, metadataFilter)
        )

    const rows = await db
      .select(listSelect)
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(whereClause)
      .orderBy(
        desc(sql`exists (
          select 1
          from mail_thread_metadata
          where mail_thread_metadata.mailbox = ${mailMessageMailbox.mailbox}
          and mail_thread_metadata.thread_key = ${mailMessage.threadKey}
          and mail_thread_metadata.pinned = true
        )`),
        desc(mailMessageMailbox.receivedAt),
        desc(mailMessageMailbox.uid)
      )
      .limit(limit)
      .offset(offset)

    perfLog('mail.listStoredMessages', {
      mailbox: mailboxPath,
      limit,
      offset,
      unreadOnly,
      rows: rows.length,
      ms: perfMs(startedAt)
    })

    return rows.map((row) =>
      normalizeMailRowFlags({
        ...row,
        receivedAt: row.receivedAt != null ? new Date(row.receivedAt) : null
      })
    )
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

export async function countStoredMessages(
  mailboxPath: string,
  unreadOnly = false,
  metadataFilter?: ThreadMetadataFilter
) {
  if (isDemoModeEnabled())
    return metadataFilter ? 0 : countDemoStoredMessages(mailboxPath, unreadOnly)
  if (unreadOnly && isAlwaysReadMailbox(mailboxPath)) return 0

  const whereClause = unreadOnly
    ? and(
        activeSnoozeCondition(),
        noPendingMoveCondition(),
        threadMetadataWhere(mailboxPath, metadataFilter),
        notLike(mailMessageMailbox.flags, '%\\\\Seen%')
      )
    : and(
        activeSnoozeCondition(),
        noPendingMoveCondition(),
        threadMetadataWhere(mailboxPath, metadataFilter)
      )
  const [row] = await db
    .select({ value: count() })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(whereClause)

  return Number(row?.value ?? 0)
}

function senderWhereClause(mailboxPath: string, normalizedSender: string) {
  return and(
    eq(mailMessageMailbox.mailbox, mailboxPath),
    noPendingMoveCondition(),
    eq(
      sql<string>`lower(trim(coalesce(nullif(substring(${mailMessage.from} from '<([^<>]+)>'), ''), ${mailMessage.from})))`,
      normalizedSender
    )
  )
}

export async function listMessagesBySender(mailboxPath: string, sender: string) {
  const normalizedSender = normalizeSenderAddress(sender)
  if (!normalizedSender) return []
  if (isDemoModeEnabled()) {
    return listDemoStoredMessages(mailboxPath, Number.MAX_SAFE_INTEGER, 0).filter(
      (message) => normalizeSenderAddress(message.from) === normalizedSender
    )
  }

  const rows = await db
    .select(detailSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(senderWhereClause(mailboxPath, normalizedSender))
    .orderBy(desc(mailMessageMailbox.receivedAt), desc(mailMessageMailbox.uid))

  return rows.map((row) =>
    withAuthenticationTrust(
      normalizeMailRowFlags({
        ...row,
        receivedAt: row.receivedAt != null ? new Date(row.receivedAt) : null
      })
    )
  )
}

export async function countMessagesBySender(mailboxPath: string, sender: string) {
  const normalizedSender = normalizeSenderAddress(sender)
  if (!normalizedSender) return 0
  if (isDemoModeEnabled()) return (await listMessagesBySender(mailboxPath, normalizedSender)).length

  const [row] = await db
    .select({ value: count() })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(senderWhereClause(mailboxPath, normalizedSender))

  return Number(row?.value ?? 0)
}

// Returns one representative message per thread, ordered by most recent activity.
export async function listStoredThreads(
  mailboxPath: string,
  limit = 100,
  offset = 0,
  unreadOnly = false,
  metadataFilter?: ThreadMetadataFilter
): Promise<ThreadRow[]> {
  if (isDemoModeEnabled()) {
    if (metadataFilter) return []
    return listDemoStoredThreads(mailboxPath, limit, offset, unreadOnly)
  }
  if (unreadOnly && isAlwaysReadMailbox(mailboxPath)) return []

  const startedAt = perfNow()
  const alwaysReadMailbox = isAlwaysReadMailbox(mailboxPath)

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
        snoozedUntil: mailMessageMailbox.snoozedUntil,
        threadId: mailThreadSummary.threadKey,
        threadCount: mailThreadSummary.threadCount,
        hasUnread: sql<boolean>`exists (
          select 1
          from mail_message_mailbox as unread_mmm
          inner join mail_message as unread_mm on unread_mmm.message_id = unread_mm.message_id
          where unread_mm.thread_key = ${mailThreadSummary.threadKey}
          and unread_mmm.mailbox = ${mailThreadSummary.mailbox}
          and unread_mmm.flags not like ${'%\\\\Seen%'}
        )`,
        important: mailMessage.aiImportant,
        hasImportantUnread: sql<boolean>`exists (
          select 1
          from mail_message_mailbox as important_mmm
          inner join mail_message as important_mm on important_mmm.message_id = important_mm.message_id
          where important_mm.thread_key = ${mailThreadSummary.threadKey}
          and important_mmm.mailbox = ${mailThreadSummary.mailbox}
          and important_mmm.flags not like ${'%\\\\Seen%'}
          and important_mm.ai_important = true
        )`,
        threadStarred: sql<boolean>`exists (
          select 1
          from mail_thread_metadata
          where mail_thread_metadata.mailbox = ${mailThreadSummary.mailbox}
          and mail_thread_metadata.thread_key = ${mailThreadSummary.threadKey}
          and mail_thread_metadata.starred = true
        )`,
        threadPinned: sql<boolean>`exists (
          select 1
          from mail_thread_metadata
          where mail_thread_metadata.mailbox = ${mailThreadSummary.mailbox}
          and mail_thread_metadata.thread_key = ${mailThreadSummary.threadKey}
          and mail_thread_metadata.pinned = true
        )`,
        hasThreadNote: sql<boolean>`exists (
          select 1
          from ${mailThreadNote}
          where ${mailThreadNote.threadKey} = ${mailThreadSummary.threadKey}
          and length(trim(${mailThreadNote.body})) > 0
        )`
      })
      .from(mailThreadSummary)
      .innerJoin(
        mailMessageMailbox,
        eq(mailMessageMailbox.id, mailThreadSummary.representativeMailboxEntryId)
      )
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(
        unreadOnly
          ? and(
              activeSnoozeCondition(),
              noPendingMoveCondition(),
              threadSummaryMetadataWhere(mailboxPath, metadataFilter),
              sql`exists (
                select 1
                from mail_message_mailbox as unread_mmm
                inner join mail_message as unread_mm on unread_mmm.message_id = unread_mm.message_id
                where unread_mm.thread_key = ${mailThreadSummary.threadKey}
                and unread_mmm.mailbox = ${mailThreadSummary.mailbox}
                and unread_mmm.flags not like ${'%\\\\Seen%'}
              )`
            )
          : and(
              activeSnoozeCondition(),
              noPendingMoveCondition(),
              threadSummaryMetadataWhere(mailboxPath, metadataFilter)
            )
      )
      .orderBy(
        desc(sql`exists (
          select 1
          from mail_thread_metadata
          where mail_thread_metadata.mailbox = ${mailThreadSummary.mailbox}
          and mail_thread_metadata.thread_key = ${mailThreadSummary.threadKey}
          and mail_thread_metadata.pinned = true
        )`),
        desc(mailThreadSummary.latestReceivedAt),
        desc(mailThreadSummary.latestUid)
      )
      .limit(limit)
      .offset(offset)

    perfLog('mail.listStoredThreads', {
      mailbox: mailboxPath,
      limit,
      offset,
      rows: rows.length,
      ms: perfMs(startedAt)
    })

    return rows.map((row) =>
      normalizeMailRowFlags({
        ...row,
        threadCount: Number(row.threadCount),
        hasUnread: alwaysReadMailbox
          ? false
          : Boolean((row as typeof row & { hasUnread: boolean | null }).hasUnread),
        hasImportantUnread: alwaysReadMailbox
          ? false
          : Boolean(
              (row as typeof row & { hasImportantUnread: boolean | null }).hasImportantUnread
            ),
        hasThreadNote: Boolean(
          (row as typeof row & { hasThreadNote: boolean | null }).hasThreadNote
        ),
        receivedAt: row.receivedAt != null ? new Date(row.receivedAt) : null
      })
    ) as unknown as ThreadRow[]
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

export async function countStoredThreads(
  mailboxPath: string,
  unreadOnly = false,
  metadataFilter?: ThreadMetadataFilter
) {
  if (isDemoModeEnabled())
    return metadataFilter ? 0 : countDemoStoredThreads(mailboxPath, unreadOnly)
  if (unreadOnly && isAlwaysReadMailbox(mailboxPath)) return 0

  const [row] = await db
    .select({ value: count() })
    .from(mailThreadSummary)
    .innerJoin(
      mailMessageMailbox,
      eq(mailMessageMailbox.id, mailThreadSummary.representativeMailboxEntryId)
    )
    .where(
      unreadOnly
        ? and(
            activeSnoozeCondition(),
            noPendingMoveCondition(),
            threadSummaryMetadataWhere(mailboxPath, metadataFilter),
            sql`exists (
              select 1
              from mail_message_mailbox as unread_mmm
              inner join mail_message as unread_mm on unread_mmm.message_id = unread_mm.message_id
              where unread_mm.thread_key = ${mailThreadSummary.threadKey}
              and unread_mmm.mailbox = ${mailThreadSummary.mailbox}
              and unread_mmm.flags not like ${'%\\\\Seen%'}
            )`
          )
        : and(
            activeSnoozeCondition(),
            noPendingMoveCondition(),
            threadSummaryMetadataWhere(mailboxPath, metadataFilter)
          )
    )

  return Number(row?.value ?? 0)
}

// Returns all messages belonging to a thread, ordered oldest-first.
export async function getMessagesInThread(
  threadKey: string,
  mailboxPath: string
): Promise<MailRow[]> {
  if (isDemoModeEnabled()) return getDemoMessagesInThread(threadKey, mailboxPath)
  const startedAt = perfNow()

  try {
    const rows = await db
      .select(detailSelect)
      .from(mailMessage)
      .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(
        and(
          eq(mailMessageMailbox.mailbox, mailboxPath),
          eq(mailMessage.threadKey, threadKey),
          noPendingMoveCondition()
        )
      )
      .orderBy(asc(mailMessage.receivedAt), asc(mailMessageMailbox.uid))
    const orderedRows = orderThread(
      rows.map((row) => withAuthenticationTrust(normalizeMailRowFlags(row)))
    )

    perfLog('mail.getMessagesInThread', {
      mailbox: mailboxPath,
      threadId: threadKey,
      rows: orderedRows.length,
      ms: perfMs(startedAt)
    })

    return orderedRows
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

export async function searchMessages(query: string, limit: number, offset: number) {
  if (isDemoModeEnabled()) return searchDemoMessages(query, limit, offset)
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

  const where = buildSearchWhere(query)
  const rows = await db
    .select(listSelect)
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(where, activeSnoozeCondition(), noPendingMoveCondition()))
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

  return deduped.map(normalizeMailRowFlags)
}

export async function searchMessagesByRegex(pattern: string, limit = 25) {
  if (isDemoModeEnabled()) return searchDemoMessagesByRegex(pattern, limit)

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '1500ms'`)
    return tx
      .select(listSelect)
      .from(mailMessage)
      .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(
        and(
          sql`concat_ws(E'\n', ${mailMessage.subject}, ${mailMessage.from}, ${mailMessage.to}, ${mailMessage.preview}, ${mailMessage.textContent}) ~* ${pattern}`,
          activeSnoozeCondition(),
          noPendingMoveCondition()
        )
      )
      .orderBy(desc(mailMessage.receivedAt))
      .limit(Math.min(limit * 3, 150))
  })

  const seen = new Set<string>()
  return rows
    .filter((row) => {
      if (seen.has(row.messageId)) return false
      seen.add(row.messageId)
      return true
    })
    .slice(0, limit)
    .map(normalizeMailRowFlags)
}

export async function countSearchMessages(query: string) {
  if (isDemoModeEnabled()) return countDemoSearchMessages(query)
  const trimmed = query.trim()
  if (!trimmed) return 0

  const where = buildSearchWhere(trimmed)
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${mailMessage.messageId})` })
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(where, activeSnoozeCondition(), noPendingMoveCondition()))

  return Number(row?.value ?? 0)
}

function buildSearchWhere(query: string) {
  const terms = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  const freeText: string[] = []
  const conditions = []

  for (const rawTerm of terms) {
    const term = rawTerm.replace(/^"|"$/g, '')
    const separator = term.indexOf(':')
    if (separator === -1) {
      freeText.push(term)
      continue
    }

    const key = term.slice(0, separator).toLowerCase()
    const value = term.slice(separator + 1)
    if (!value) continue

    if (key === 'from') conditions.push(ilike(mailMessage.from, `%${value}%`))
    else if (key === 'to') conditions.push(ilike(mailMessage.to, `%${value}%`))
    else if (key === 'subject') conditions.push(ilike(mailMessage.subject, `%${value}%`))
    else if (key === 'before') {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) conditions.push(sql`${mailMessage.receivedAt} < ${date}`)
    } else if (key === 'after') {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) conditions.push(sql`${mailMessage.receivedAt} > ${date}`)
    } else if (key === 'has' && value.toLowerCase() === 'attachment') {
      conditions.push(
        sql`exists (select 1 from mail_attachment where mail_attachment.message_id = ${mailMessage.messageId})`
      )
    } else {
      freeText.push(term)
    }
  }

  const textQuery = freeText.join(' ').trim()
  if (textQuery) {
    const pattern = `%${textQuery}%`
    conditions.push(
      or(
        ilike(mailMessage.subject, pattern),
        ilike(mailMessage.from, pattern),
        ilike(mailMessage.to, pattern),
        ilike(mailMessage.textContent, pattern)
      )
    )
  }

  if (conditions.length === 0) return sql`true`
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}

export async function getStoredMessageById(id: string | number): Promise<MailRow | null> {
  if (isDemoModeEnabled()) return getDemoStoredMessageById(id)
  const numericId = typeof id === 'string' ? parseInt(id, 10) : id
  const [message] = await db
    .select(detailSelect)
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.id, numericId))
    .limit(1)

  return message ? withAuthenticationTrust(normalizeMailRowFlags(message)) : null
}

export async function getStoredRawMessageById(
  id: string | number
): Promise<Buffer | null | undefined> {
  if (isDemoModeEnabled()) {
    const message = getDemoStoredMessageById(id)
    if (!message) return undefined
    return Buffer.from(
      [
        `Message-ID: ${message.messageId}`,
        `Date: ${message.receivedAt?.toUTCString() ?? ''}`,
        `From: ${message.from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        message.textContent
      ].join('\r\n')
    )
  }

  const numericId = typeof id === 'string' ? Number.parseInt(id, 10) : id
  if (!Number.isInteger(numericId)) return undefined
  const [message] = await db
    .select({ rawSource: mailMessageMailbox.rawSource })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(eq(mailMessageMailbox.id, numericId))
    .limit(1)
  return message?.rawSource
}

export async function snoozeMessages(ids: number[], snoozedUntil: Date | null) {
  if (ids.length === 0) return 0
  if (isDemoModeEnabled()) return snoozeDemoMessages(ids, snoozedUntil)

  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      mailbox: mailMessageMailbox.mailbox,
      threadKey: mailMessage.threadKey
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(inArray(mailMessageMailbox.id, ids))

  if (rows.length === 0) return 0

  await db
    .update(mailMessageMailbox)
    .set({ snoozedUntil })
    .where(
      inArray(
        mailMessageMailbox.id,
        rows.map((row) => row.id)
      )
    )

  const touchedThreadKeysByMailbox = new Map<string, Set<string>>()
  for (const row of rows) {
    const touchedThreadKeys = touchedThreadKeysByMailbox.get(row.mailbox) ?? new Set<string>()
    touchedThreadKeys.add(row.threadKey)
    touchedThreadKeysByMailbox.set(row.mailbox, touchedThreadKeys)
  }

  for (const [mailbox, threadKeys] of touchedThreadKeysByMailbox) {
    await refreshThreadSummaries(mailbox, threadKeys)
  }

  return rows.length
}

export async function markMessagesSeen(ids: number[], seen: boolean) {
  const selected = await db
    .select({ messageId: mailMessageMailbox.messageId })
    .from(mailMessageMailbox)
    .where(inArray(mailMessageMailbox.id, ids))
  const messageIds = [...new Set(selected.map((row) => row.messageId))]
  if (messageIds.length === 0) return 0

  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      messageId: mailMessageMailbox.messageId,
      mailbox: mailMessageMailbox.mailbox,
      uid: mailMessageMailbox.uid,
      flags: mailMessageMailbox.flags,
      threadKey: mailMessage.threadKey
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(inArray(mailMessageMailbox.messageId, messageIds))

  const changedRows = changedReadStateCopies(rows, new Set(messageIds), seen)
  const touchedThreadKeysByMailbox = new Map<string, Set<string>>()

  await db.transaction(async (tx) => {
    for (const row of changedRows) {
      await tx
        .update(mailMessageMailbox)
        .set({ flags: row.flags })
        .where(eq(mailMessageMailbox.id, row.id))

      const job = seenJob(row.uid, row.mailbox, seen)
      const now = new Date()
      await tx
        .insert(imapJob)
        .values({
          type: job.type,
          mailbox: row.mailbox,
          uid: row.uid,
          targetMailbox: null,
          status: 'pending',
          dedupeKey: job.dedupeKey,
          attemptCount: 0,
          availableAt: now,
          lastError: null,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: imapJob.dedupeKey,
          set: {
            type: job.type,
            status: 'pending',
            attemptCount: 0,
            availableAt: now,
            lastError: null,
            updatedAt: now
          }
        })

      const touchedThreadKeys = touchedThreadKeysByMailbox.get(row.mailbox) ?? new Set<string>()
      touchedThreadKeys.add(row.threadKey)
      touchedThreadKeysByMailbox.set(row.mailbox, touchedThreadKeys)
    }
  })

  if (seen) await dismissReadNotifications(changedRows.map((row) => row.id))

  for (const [mailbox, threadKeys] of touchedThreadKeysByMailbox) {
    await refreshThreadSummaries(mailbox, threadKeys)
  }

  return changedRows.length
}

export async function markMessageAsRead(message: MailRow) {
  if (isDemoModeEnabled()) {
    markDemoMessageAsRead(message)
    return
  }

  try {
    await markMessagesSeen([message.id], true)
  } catch (error) {
    logServerError('mail.markMessageAsRead', error, {
      messageId: message.id,
      mailbox: message.mailbox,
      uid: message.uid
    })
  }
}

export async function markMessageAsUnread(message: MailRow) {
  if (isDemoModeEnabled()) {
    markDemoMessageAsUnread(message)
    return
  }

  try {
    await markMessagesSeen([message.id], false)
  } catch (error) {
    logServerError('mail.markMessageAsUnread', error, {
      messageId: message.id,
      mailbox: message.mailbox,
      uid: message.uid
    })
  }
}

export type MessageAction = 'archive' | 'trash' | 'spam' | 'inbox'

const ROLE_PATTERNS: Record<MessageAction, RegExp> = {
  inbox: /\binbox\b|받은메일함|받은\s?메일함/i,
  archive: /\b(archive|all[\s._-]?mail)\b|전체보관함|보관함/i,
  trash: /\b(trash|deleted[\s._-]?(items|messages)?)\b|휴지통|지운\s?편지함/i,
  spam: /\b(spam|junk([\s._-]?email)?)\b|스팸|스팸함|스팸편지함/i
}

const ROLE_SPECIAL_USE: Record<MessageAction, string[]> = {
  inbox: ['\\Inbox'],
  archive: ['\\Archive', '\\All'],
  trash: ['\\Trash'],
  spam: ['\\Junk']
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
  return (
    mailboxes.find((mailbox) => ROLE_SPECIAL_USE[action].includes(mailbox.specialUse ?? ''))
      ?.path ??
    mailboxes.find((mailbox) => pattern.test(mailbox.path) || pattern.test(mailbox.name))?.path ??
    null
  )
}

export async function createShareToken(mailboxEntryId: number): Promise<string | null> {
  if (isDemoModeEnabled()) return createDemoShareToken(mailboxEntryId)
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
  if (isDemoModeEnabled()) return getDemoMessageByShareToken(token)
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
  if (isDemoModeEnabled()) return moveDemoMessage(message, action)
  const targetMailbox = await findMailboxForAction(action)
  if (!targetMailbox || targetMailbox === message.mailbox) return null

  await scheduleMoveMessage(message.uid, message.mailbox, targetMailbox)
  return targetMailbox
}
