import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listImapMailboxes, listStoredMessages, listStoredThreads, searchMessages } from '$lib/server/mail'
import { slugToPath } from '$lib/mailbox'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function serializeMessage(
  message: Awaited<ReturnType<typeof listStoredMessages>>[number] & { threadCount?: number },
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
    threadId: message.threadId ?? null,
    ...(message.threadCount !== undefined ? { threadCount: message.threadCount } : {}),
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
  const threaded = url.searchParams.get('threaded') === '1'

  const mailboxPath = slugToPath(mailboxSlug, listImapMailboxes())

  if (threaded) {
    const threads = listStoredThreads(mailboxPath, limit + 1, offset)
    const hasMore = threads.length > limit
    return json({
      messages: threads.slice(0, limit).map((m) => serializeMessage(m)),
      hasMore
    })
  }

  const messages = await listStoredMessages(mailboxPath, limit + 1, offset)
  const hasMore = messages.length > limit

  return json({
    messages: messages.slice(0, limit).map((m) => serializeMessage(m)),
    hasMore
  })
}
