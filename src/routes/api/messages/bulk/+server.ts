import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessage, mailMessageMailbox } from '$lib/server/db/schema'
import { and, inArray, eq } from 'drizzle-orm'
import {
  getStoredMessageById,
  markMessagesSeen,
  moveMessage,
  resolveMailboxPath,
  snoozeMessages,
  type MessageAction
} from '$lib/server/mail'
import { isDemoModeEnabled, markDemoMessagesSeen } from '$lib/server/demo'

const VALID_MOVE_ACTIONS = new Set<MessageAction>(['archive', 'trash', 'spam', 'inbox'])

function parseSnoozedUntil(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

async function expandThreadIds(ids: number[], mailbox: string) {
  const selected = await db
    .select({ threadKey: mailMessage.threadKey })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(inArray(mailMessageMailbox.id, ids))
  const threadKeys = [...new Set(selected.map((row) => row.threadKey))]
  if (threadKeys.length === 0) return []

  return db
    .select({ id: mailMessageMailbox.id })
    .from(mailMessageMailbox)
    .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(and(eq(mailMessageMailbox.mailbox, mailbox), inArray(mailMessage.threadKey, threadKeys)))
    .then((rows) => rows.map((row) => row.id))
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  let ids = body.ids as number[]
  const action = body.action as string

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(400, 'ids must be a non-empty array')
  }

  if (body.threaded === true) {
    if (typeof body.mailbox !== 'string' || !body.mailbox.trim()) {
      return error(400, 'mailbox is required for threaded actions')
    }
    ids = await expandThreadIds(ids, await resolveMailboxPath(body.mailbox))
  }

  if (action === 'mark_read' || action === 'mark_unread') {
    if (isDemoModeEnabled()) {
      const count = markDemoMessagesSeen(ids, action === 'mark_read')
      return json({ ok: true, count })
    }
    const count = await markMessagesSeen(ids, action === 'mark_read')
    return json({ ok: true, count })
  }

  if (action === 'snooze' || action === 'unsnooze') {
    const snoozedUntil = action === 'unsnooze' ? null : parseSnoozedUntil(body.snoozedUntil)
    if (snoozedUntil === undefined) return error(400, 'snoozedUntil must be a valid date')
    if (snoozedUntil !== null && snoozedUntil.getTime() <= Date.now()) {
      return error(400, 'snoozedUntil must be in the future')
    }

    const count = await snoozeMessages(ids, snoozedUntil)
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

  if (action === 'spam' && count === 0) {
    return error(422, 'Spam mailbox not found')
  }

  return json({ ok: true, count })
}
