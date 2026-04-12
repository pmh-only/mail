import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listImapMailboxes, listStoredMessages, searchMessages } from '$lib/server/mail'
import { slugToPath } from '$lib/mailbox'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function serializeMessage(
  message: Awaited<ReturnType<typeof listStoredMessages>>[number],
  includeMailbox = false
) {
  return {
    id: message.id,
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: message.preview,
    textContent: message.textContent,
    flags: JSON.parse(message.flags) as string[],
    receivedAt: message.receivedAt?.toISOString() ?? null,
    ...(includeMailbox ? { mailbox: message.mailbox } : {})
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? ''

  if (q) {
    const offset = parsePositiveInt(url.searchParams.get('offset'), 0)
    const requestedLimit = parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT)
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)

    const messages = await searchMessages(q, limit + 1, offset)
    const hasMore = messages.length > limit

    return json({
      messages: messages.slice(0, limit).map((m) => serializeMessage(m, true)),
      hasMore
    })
  }

  const offset = parsePositiveInt(url.searchParams.get('offset'), 0)
  const requestedLimit = parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT)
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
  const mailboxSlug = url.searchParams.get('mailbox') ?? 'inbox'

  const mailboxPath = slugToPath(mailboxSlug, listImapMailboxes())

  const messages = await listStoredMessages(mailboxPath, limit + 1, offset)
  const hasMore = messages.length > limit

  return json({
    messages: messages.slice(0, limit).map((m) => serializeMessage(m)),
    hasMore
  })
}
