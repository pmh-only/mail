import { db } from './db'
import { mailFilter, mailMessage, mailMessageMailbox } from './db/schema'
import { desc, eq, inArray } from 'drizzle-orm'
import { scheduleAddFlag, scheduleMarkRead, scheduleMoveMessage } from './imap-operations'
import {
  normalizeFilterConditions,
  type FilterCondition,
  type FilterConditionSet
} from '$lib/filter-conditions'

type Filter = typeof mailFilter.$inferSelect

export type FilterPreviewRow = {
  id: number
  messageId: string
  subject: string
  from: string
  mailbox: string
  receivedAt: Date | null
}

function getConditionSet(filter: Filter): FilterConditionSet {
  return normalizeFilterConditions(filter.conditions, {
    field: filter.field,
    operator: filter.operator,
    value: filter.value
  })
}

function matchesCondition(condition: FilterCondition, value: string): boolean {
  const v = value.toLowerCase()
  const target = condition.value.toLowerCase()
  switch (condition.operator) {
    case 'contains':
      return v.includes(target)
    case 'equals':
      return v === target
    case 'starts_with':
      return v.startsWith(target)
    case 'ends_with':
      return v.endsWith(target)
    default:
      return false
  }
}

function getFieldValue(
  condition: Pick<FilterCondition, 'field'>,
  msg: Pick<typeof mailMessage.$inferSelect, 'from' | 'to' | 'subject' | 'cc'>
): string {
  switch (condition.field) {
    case 'from':
      return msg.from
    case 'to':
      return msg.to
    case 'subject':
      return msg.subject
    case 'cc':
      return msg.cc
    default:
      return ''
  }
}

function filterFlag(filter: Filter): string | null {
  if (filter.action === 'star') return '\\Flagged'

  const label = filter.target?.trim()
  if (!label) return null
  return label.startsWith('$') || label.startsWith('\\') ? label : `$${label.replace(/\s+/g, '-')}`
}

function matchesFilter(
  filter: Filter,
  msg: Pick<typeof mailMessage.$inferSelect, 'from' | 'to' | 'subject' | 'cc'>
): boolean {
  const conditionSet = getConditionSet(filter)
  if (conditionSet.conditions.length === 0) return false

  const check = (condition: FilterCondition) =>
    matchesCondition(condition, getFieldValue(condition, msg))

  return conditionSet.match === 'any'
    ? conditionSet.conditions.some(check)
    : conditionSet.conditions.every(check)
}

export async function runFiltersOnMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return

  const touchedThreadKeysByMailbox = new Map<string, Set<string>>()
  const { applySenderRulesToMessages } = await import('./sender-rules')
  const blockedMessageIds = await applySenderRulesToMessages(messageIds)
  const filterableMessageIds = messageIds.filter((messageId) => !blockedMessageIds.has(messageId))

  if (filterableMessageIds.length === 0) return

  // Load all enabled filters ordered by sort_order
  const filters = await db
    .select()
    .from(mailFilter)
    .where(eq(mailFilter.enabled, true))
    .orderBy(mailFilter.sortOrder)

  if (filters.length === 0) return

  // Load the messages
  const messages = await db
    .select()
    .from(mailMessage)
    .where(inArray(mailMessage.messageId, filterableMessageIds))

  for (const msg of messages) {
    for (const filter of filters) {
      if (!matchesFilter(filter, msg)) continue

      // Match! Execute action.
      if (filter.action === 'mark_read') {
        const entries = await db
          .select()
          .from(mailMessageMailbox)
          .where(eq(mailMessageMailbox.messageId, msg.messageId))

        for (const entry of entries) {
          const flags: string[] = JSON.parse(entry.flags)
          if (!flags.includes('\\Seen')) {
            await db
              .update(mailMessageMailbox)
              .set({ flags: JSON.stringify([...flags, '\\Seen']) })
              .where(eq(mailMessageMailbox.id, entry.id))
            await scheduleMarkRead(entry.uid, entry.mailbox)
          }
        }
      } else if (filter.action === 'star' || filter.action === 'label') {
        const flag = filterFlag(filter)
        if (!flag) break

        const entries = await db
          .select()
          .from(mailMessageMailbox)
          .where(eq(mailMessageMailbox.messageId, msg.messageId))

        for (const entry of entries) {
          const flags: string[] = JSON.parse(entry.flags)
          if (flags.includes(flag)) continue

          await db
            .update(mailMessageMailbox)
            .set({ flags: JSON.stringify([...flags, flag]) })
            .where(eq(mailMessageMailbox.id, entry.id))
          await scheduleAddFlag(entry.uid, entry.mailbox, flag)
        }
      } else if (
        filter.action === 'trash' ||
        filter.action === 'delete' ||
        filter.action === 'move'
      ) {
        const targetMailbox = filter.action === 'move' ? filter.target : null
        if (filter.action === 'move' && !targetMailbox) break

        const entries = await db
          .select()
          .from(mailMessageMailbox)
          .where(eq(mailMessageMailbox.messageId, msg.messageId))

        for (const entry of entries) {
          let destination = targetMailbox

          if (filter.action === 'trash' || filter.action === 'delete') {
            // Find trash mailbox from known mailboxes
            const { getImapMailboxes } = await import('./mail')
            const mailboxes = await getImapMailboxes()
            const trashMb = mailboxes.find((mb) =>
              /\b(trash|deleted[\s._-]?(items|messages)?)\b/i.test(mb.name + ' ' + mb.path)
            )
            if (!trashMb) continue
            destination = trashMb.path
          }

          if (!destination || destination === entry.mailbox) continue
          await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, entry.id))
          const touchedThreadKeys =
            touchedThreadKeysByMailbox.get(entry.mailbox) ?? new Set<string>()
          touchedThreadKeys.add(msg.threadKey)
          touchedThreadKeysByMailbox.set(entry.mailbox, touchedThreadKeys)
          await scheduleMoveMessage(entry.uid, entry.mailbox, destination)
        }
      }

      // First-match wins — stop evaluating further rules for this message
      break
    }
  }

  if (touchedThreadKeysByMailbox.size === 0) return

  const { refreshThreadSummaries } = await import('./mail')
  for (const [mailbox, threadKeys] of touchedThreadKeysByMailbox) {
    await refreshThreadSummaries(mailbox, threadKeys)
  }
}

export async function previewFilterMatches(
  filter: Filter,
  limit = 20
): Promise<FilterPreviewRow[]> {
  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      messageId: mailMessage.messageId,
      subject: mailMessage.subject,
      from: mailMessage.from,
      to: mailMessage.to,
      cc: mailMessage.cc,
      mailbox: mailMessageMailbox.mailbox,
      receivedAt: mailMessage.receivedAt
    })
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .orderBy(desc(mailMessage.receivedAt))
    .limit(500)

  return rows.filter((row) => matchesFilter(filter, row)).slice(0, limit)
}

export async function runFiltersOnExistingMessages(): Promise<number> {
  const rows = await db.select({ messageId: mailMessage.messageId }).from(mailMessage)
  const messageIds = [...new Set(rows.map((row) => row.messageId))]
  await runFiltersOnMessages(messageIds)
  return messageIds.length
}
