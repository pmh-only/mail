import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { resolveMailboxPath, splitThreadFromMessage } from '$lib/server/mail'

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null)
  const mailbox = typeof body?.mailbox === 'string' ? body.mailbox : ''
  const messageId = Number(body?.messageId)

  if (!mailbox.trim()) {
    error(400, 'mailbox is required')
  }

  if (!Number.isInteger(messageId) || messageId <= 0) {
    error(400, 'messageId must be a positive integer')
  }

  const mailboxPath = await resolveMailboxPath(mailbox)
  const result = await splitThreadFromMessage(params.threadId, mailboxPath, messageId)

  if (!result) {
    error(422, 'Thread cannot be split at the selected message')
  }

  return json({ ok: true, ...result })
}
