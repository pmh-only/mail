import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessage, mailMessageMailbox } from '$lib/server/db/schema'
import { inArray, eq } from 'drizzle-orm'
import {
  getStoredMessageById,
  moveMessage,
  refreshThreadSummaries,
  type MessageAction
} from '$lib/server/mail'
import { enqueueMarkRead, enqueueMarkUnread } from '$lib/server/imap-queue'
import { isDemoModeEnabled, markDemoMessagesSeen } from '$lib/server/demo'

const VALID_MOVE_ACTIONS = new Set<MessageAction>(['archive', 'trash', 'spam', 'inbox'])

async function markSeen(ids: number[], seen: boolean) {
  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      mailbox: mailMessageMailbox.mailbox,
      uid: mailMessageMailbox.uid,
      flags: mailMessageMailbox.flags,
      threadKey: mailMessage.threadKey
    })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(inArray(mailMessageMailbox.id, ids))

  let count = 0
  const touchedThreadKeysByMailbox = new Map<string, Set<string>>()

  for (const row of rows) {
    const flags: string[] = JSON.parse(row.flags)
    const isSeen = flags.includes('\\Seen')
    if (isSeen === seen) continue

    const newFlags = seen ? [...flags, '\\Seen'] : flags.filter((flag) => flag !== '\\Seen')
    await db
      .update(mailMessageMailbox)
      .set({ flags: JSON.stringify(newFlags) })
      .where(eq(mailMessageMailbox.id, row.id))

    if (seen) {
      await enqueueMarkRead(row.uid, row.mailbox)
    } else {
      await enqueueMarkUnread(row.uid, row.mailbox)
    }

    const touchedThreadKeys = touchedThreadKeysByMailbox.get(row.mailbox) ?? new Set<string>()
    touchedThreadKeys.add(row.threadKey)
    touchedThreadKeysByMailbox.set(row.mailbox, touchedThreadKeys)
    count++
  }

  for (const [mailbox, threadKeys] of touchedThreadKeysByMailbox) {
    await refreshThreadSummaries(mailbox, threadKeys)
  }

  return count
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const ids = body.ids as number[]
  const action = body.action as string

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(400, 'ids must be a non-empty array')
  }

  if (action === 'mark_read' || action === 'mark_unread') {
    if (isDemoModeEnabled()) {
      const count = markDemoMessagesSeen(ids, action === 'mark_read')
      return json({ ok: true, count })
    }
    const count = await markSeen(ids, action === 'mark_read')
    return json({ ok: true, count })
  }

  if (!VALID_MOVE_ACTIONS.has(action as MessageAction)) {
    return error(400, `Invalid action: ${action}`)
  }

  let count = 0
  for (const id of ids) {
    const message = await getStoredMessageById(String(id))
    if (!message) continue
    const result = await moveMessage(message, action as MessageAction)
    if (result) count++
  }

  return json({ ok: true, count })
}
