import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessageMailbox } from '$lib/server/db/schema'
import { inArray, eq } from 'drizzle-orm'
import { getStoredMessageById, moveMessage, type MessageAction } from '$lib/server/mail'
import { enqueueMarkRead } from '$lib/server/imap-queue'

const VALID_MOVE_ACTIONS = new Set<MessageAction>(['archive', 'trash', 'spam', 'inbox'])

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const ids = body.ids as number[]
  const action = body.action as string

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(400, 'ids must be a non-empty array')
  }

  if (action === 'mark_read') {
    const rows = await db
      .select({
        id: mailMessageMailbox.id,
        mailbox: mailMessageMailbox.mailbox,
        uid: mailMessageMailbox.uid,
        flags: mailMessageMailbox.flags
      })
      .from(mailMessageMailbox)
      .where(inArray(mailMessageMailbox.id, ids))

    let count = 0
    for (const row of rows) {
      const flags: string[] = JSON.parse(row.flags)
      if (!flags.includes('\\Seen')) {
        const newFlags = [...flags, '\\Seen']
        await db
          .update(mailMessageMailbox)
          .set({ flags: JSON.stringify(newFlags) })
          .where(eq(mailMessageMailbox.id, row.id))
        enqueueMarkRead(row.uid, row.mailbox)
        count++
      }
    }
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
