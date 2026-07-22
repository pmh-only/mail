import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from './db'
import { mailCleanupRule, mailMessage, mailMessageMailbox } from './db/schema'
import { scheduleMoveMessage } from './imap-operations'
import { getImapMailboxes, getMailboxRole, refreshThreadSummaries } from './mail'

const MIN_AGE_DAYS = 7
const DEFAULT_PREVIEW_LIMIT = 20
const DEFAULT_RUN_LIMIT = 50
const CLEANUP_RUN_INTERVAL_MS = 60 * 60 * 1000

type CleanupRule = typeof mailCleanupRule.$inferSelect

export type CleanupRuleInput = {
  enabled?: boolean
  mailbox?: string | null
  minAgeDays: number
}

export type CleanupPreviewRow = {
  id: number
  messageId: string
  subject: string
  from: string
  mailbox: string
  receivedAt: Date | null
}

let lastWorkerRunAt = 0
let workerRunInFlight = false

function validateMinAgeDays(value: unknown): number {
  const minAgeDays = Number(value)
  if (!Number.isInteger(minAgeDays) || minAgeDays < MIN_AGE_DAYS) {
    throw new Error(`Cleanup age must be at least ${MIN_AGE_DAYS} days.`)
  }
  return minAgeDays
}

function normalizeMailbox(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cutoffForRule(rule: Pick<CleanupRule, 'minAgeDays'>) {
  return new Date(Date.now() - rule.minAgeDays * 24 * 60 * 60 * 1000)
}

async function findArchiveMailbox(): Promise<string | null> {
  const mailboxes = await getImapMailboxes()
  return (
    mailboxes.find((mailbox) => getMailboxRole(mailbox.path) === 'archive')?.path ??
    mailboxes.find((mailbox) => getMailboxRole(mailbox.name) === 'archive')?.path ??
    null
  )
}

async function getCleanupCandidates(
  rule: CleanupRule,
  limit: number
): Promise<CleanupPreviewRow[]> {
  const conditions = [lt(mailMessageMailbox.receivedAt, cutoffForRule(rule))]
  if (rule.mailbox) conditions.push(eq(mailMessageMailbox.mailbox, rule.mailbox))

  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      messageId: mailMessage.messageId,
      subject: mailMessage.subject,
      from: mailMessage.from,
      mailbox: mailMessageMailbox.mailbox,
      receivedAt: mailMessageMailbox.receivedAt
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(...conditions))
    .orderBy(desc(mailMessageMailbox.receivedAt), desc(mailMessageMailbox.uid))
    .limit(Math.max(limit * 4, limit))

  return rows
    .filter((row) => {
      const role = getMailboxRole(row.mailbox)
      return role !== 'archive' && role !== 'trash' && role !== 'spam'
    })
    .slice(0, limit)
}

export function normalizeCleanupRuleInput(input: CleanupRuleInput) {
  return {
    enabled: input.enabled !== false,
    mailbox: normalizeMailbox(input.mailbox),
    minAgeDays: validateMinAgeDays(input.minAgeDays),
    action: 'archive'
  }
}

export type CleanupPreviewResult = {
  matches: CleanupPreviewRow[]
  warning?: string | null
}

export async function previewCleanupRule(
  input: CleanupRuleInput,
  limit = DEFAULT_PREVIEW_LIMIT
): Promise<CleanupPreviewResult> {
  const rule = {
    id: 0,
    ...normalizeCleanupRuleInput(input),
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  let warning: string | null = null
  if (rule.mailbox) {
    const role = getMailboxRole(rule.mailbox)
    if (role === 'trash' || role === 'archive' || role === 'spam') {
      warning = `이 메일함('${rule.mailbox}')은 분류가 '${role}'(이)므로 보관(Archive) 청소 규칙이 적용되지 않습니다.`
    }
  }

  const matches = await getCleanupCandidates(rule, limit)
  return { matches, warning }
}

export async function runCleanupRules(limitPerRule = DEFAULT_RUN_LIMIT): Promise<number> {
  const rules = await db
    .select()
    .from(mailCleanupRule)
    .where(and(eq(mailCleanupRule.enabled, true), eq(mailCleanupRule.action, 'archive')))

  if (rules.length === 0) return 0

  const archiveMailbox = await findArchiveMailbox()
  if (!archiveMailbox) return 0

  let archived = 0

  for (const rule of rules) {
    const conditions = [lt(mailMessageMailbox.receivedAt, cutoffForRule(rule))]
    if (rule.mailbox) conditions.push(eq(mailMessageMailbox.mailbox, rule.mailbox))

    const candidates = await db
      .select({
        id: mailMessageMailbox.id,
        messageId: mailMessage.messageId,
        mailbox: mailMessageMailbox.mailbox,
        uid: mailMessageMailbox.uid,
        threadKey: mailMessage.threadKey,
        receivedAt: mailMessageMailbox.receivedAt
      })
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(and(...conditions))
      .orderBy(desc(mailMessageMailbox.receivedAt), desc(mailMessageMailbox.uid))
      .limit(limitPerRule * 4)

    const touchedThreadKeysByMailbox = new Map<string, Set<string>>()
    let archivedForRule = 0

    for (const candidate of candidates) {
      if (archivedForRule >= limitPerRule) break
      if (candidate.mailbox === archiveMailbox) continue
      const role = getMailboxRole(candidate.mailbox)
      if (role === 'archive' || role === 'trash' || role === 'spam') continue

      await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, candidate.id))
      const threadKeys = touchedThreadKeysByMailbox.get(candidate.mailbox) ?? new Set<string>()
      threadKeys.add(candidate.threadKey || candidate.messageId)
      touchedThreadKeysByMailbox.set(candidate.mailbox, threadKeys)
      await scheduleMoveMessage(candidate.uid, candidate.mailbox, archiveMailbox)
      archived += 1
      archivedForRule += 1
    }

    for (const [mailbox, threadKeys] of touchedThreadKeysByMailbox) {
      await refreshThreadSummaries(mailbox, threadKeys)
    }

    await db
      .update(mailCleanupRule)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(mailCleanupRule.id, rule.id))
  }

  return archived
}

export async function maybeRunCleanupRulesFromWorker() {
  if (workerRunInFlight) return 0
  if (Date.now() - lastWorkerRunAt < CLEANUP_RUN_INTERVAL_MS) return 0

  workerRunInFlight = true
  try {
    lastWorkerRunAt = Date.now()
    return await runCleanupRules()
  } finally {
    workerRunInFlight = false
  }
}
