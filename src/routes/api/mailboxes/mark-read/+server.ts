import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { markMailboxMessagesSeen } from '$lib/server/mail'

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as { mailbox?: string }
    if (!body.mailbox) {
      return error(400, 'Missing mailbox parameter')
    }

    const count = await markMailboxMessagesSeen(body.mailbox)
    return json({ count })
  } catch (err) {
    return error(400, err instanceof Error ? err.message : 'Failed to mark mailbox as read')
  }
}
