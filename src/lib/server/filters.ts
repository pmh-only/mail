import { db } from './db'
import { mailFilter, mailMessage, mailMessageMailbox } from './db/schema'
import { eq, inArray } from 'drizzle-orm'
import { enqueueMarkRead, enqueueMoveMessage } from './imap-queue'

type Filter = typeof mailFilter.$inferSelect

function matchesRule(filter: Filter, value: string): boolean {
  const v = value.toLowerCase()
  const target = filter.value.toLowerCase()
  switch (filter.operator) {
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

function getFieldValue(filter: Filter, msg: typeof mailMessage.$inferSelect): string {
  switch (filter.field) {
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

export async function runFiltersOnMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return

  const touchedThreadKeysByMailbox = new Map<string, Set<string>>()

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
    .where(inArray(mailMessage.messageId, messageIds))

  for (const msg of messages) {
    for (const filter of filters) {
      const fieldValue = getFieldValue(filter, msg)
      if (!matchesRule(filter, fieldValue)) continue

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
            await enqueueMarkRead(entry.uid, entry.mailbox)
          }
        }
      } else if (filter.action === 'trash' || filter.action === 'move') {
        const targetMailbox = filter.action === 'move' ? filter.target : null
        if (filter.action === 'move' && !targetMailbox) break

        const entries = await db
          .select()
          .from(mailMessageMailbox)
          .where(eq(mailMessageMailbox.messageId, msg.messageId))

        for (const entry of entries) {
          let destination = targetMailbox

          if (filter.action === 'trash') {
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
          await enqueueMoveMessage(entry.uid, entry.mailbox, destination)
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
