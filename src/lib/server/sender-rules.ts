import { desc, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { mailMessage, mailMessageMailbox, mailSenderRule } from './db/schema'
import { scheduleMoveMessage } from './imap-operations'
import { getImapMailboxes, refreshThreadSummaries } from './mail'

export type SenderRuleType = 'block' | 'allow'

export type SenderRuleRow = typeof mailSenderRule.$inferSelect

const VALID_SENDER_RULE_TYPES = new Set<SenderRuleType>(['block', 'allow'])

export function isSenderRuleType(value: unknown): value is SenderRuleType {
  return typeof value === 'string' && VALID_SENDER_RULE_TYPES.has(value as SenderRuleType)
}

export function normalizeSender(sender: string): string {
  const trimmed = sender.trim().toLowerCase()
  const bracketMatch = trimmed.match(/<([^>]+)>/)
  const email =
    bracketMatch?.[1] ?? trimmed.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]
  return (email ?? trimmed).trim().toLowerCase()
}

export async function listSenderRules(): Promise<SenderRuleRow[]> {
  return db.select().from(mailSenderRule).orderBy(desc(mailSenderRule.createdAt))
}

export async function addSenderRule(type: SenderRuleType, sender: string): Promise<number | null> {
  const normalizedSender = normalizeSender(sender)
  if (!normalizedSender) return null

  const [inserted] = await db
    .insert(mailSenderRule)
    .values({ type, sender: sender.trim(), normalizedSender })
    .onConflictDoUpdate({
      target: [mailSenderRule.type, mailSenderRule.normalizedSender],
      set: { sender: sender.trim(), createdAt: new Date() }
    })
    .returning({ id: mailSenderRule.id })

  return inserted?.id ?? null
}

export async function deleteSenderRule(id: number): Promise<void> {
  await db.delete(mailSenderRule).where(eq(mailSenderRule.id, id))
}

export async function applySenderRulesToMessages(messageIds: string[]): Promise<Set<string>> {
  const blockedMessageIds = new Set<string>()
  if (messageIds.length === 0) return blockedMessageIds

  const rules = await db.select().from(mailSenderRule)
  if (rules.length === 0) return blockedMessageIds

  const allowlist = new Set(
    rules.filter((rule) => rule.type === 'allow').map((rule) => rule.normalizedSender)
  )
  const blocklist = new Set(
    rules.filter((rule) => rule.type === 'block').map((rule) => rule.normalizedSender)
  )

  if (blocklist.size === 0) return blockedMessageIds

  const messages = await db
    .select({
      messageId: mailMessage.messageId,
      from: mailMessage.from,
      threadKey: mailMessage.threadKey
    })
    .from(mailMessage)
    .where(inArray(mailMessage.messageId, messageIds))

  const blockedThreadKeysByMailbox = new Map<string, Set<string>>()
  const mailboxes = await getImapMailboxes()
  const trashMailbox = mailboxes.find((mb) =>
    /\b(trash|deleted[\s._-]?(items|messages)?)\b/i.test(`${mb.name} ${mb.path}`)
  )

  if (!trashMailbox) return blockedMessageIds

  for (const message of messages) {
    const sender = normalizeSender(message.from)
    if (!sender || allowlist.has(sender) || !blocklist.has(sender)) continue

    blockedMessageIds.add(message.messageId)
    const entries = await db
      .select()
      .from(mailMessageMailbox)
      .where(eq(mailMessageMailbox.messageId, message.messageId))

    for (const entry of entries) {
      if (entry.mailbox === trashMailbox.path) continue
      await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, entry.id))
      await scheduleMoveMessage(entry.uid, entry.mailbox, trashMailbox.path)

      const threadKeys = blockedThreadKeysByMailbox.get(entry.mailbox) ?? new Set<string>()
      threadKeys.add(message.threadKey)
      blockedThreadKeysByMailbox.set(entry.mailbox, threadKeys)
    }
  }

  if (blockedThreadKeysByMailbox.size > 0) {
    for (const [mailbox, threadKeys] of blockedThreadKeysByMailbox) {
      await refreshThreadSummaries(mailbox, threadKeys)
    }
  }

  return blockedMessageIds
}
