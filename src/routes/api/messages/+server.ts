import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  countSearchMessages,
  countStoredMessages,
  countStoredThreads,
  listStoredMessages,
  listStoredThreads,
  resolveMailboxPath,
  searchMessages,
  type MailListRow,
  type ThreadRow
} from '$lib/server/mail'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function serializeMessage(message: MailListRow | ThreadRow, includeMailbox = false) {
  return {
    id: message.id,
    messageId: message.messageId,
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: message.preview,
    flags: JSON.parse(message.flags) as string[],
    receivedAt: message.receivedAt?.toISOString() ?? null,
    threadId: message.threadId ?? null,
    ...('threadCount' in message ? { threadCount: message.threadCount } : {}),
    ...(includeMailbox ? { mailbox: message.mailbox } : {})
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const startedAt = perfNow()
  const q = url.searchParams.get('q')?.trim() ?? ''

  if (q) {
    const offset = parsePositiveInt(url.searchParams.get('offset'), 0)
    const requestedLimit = parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT)
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)

    const [messages, total] = await Promise.all([
      searchMessages(q, limit + 1, offset),
      countSearchMessages(q)
    ])
    const hasMore = messages.length > limit

    const body = {
      messages: messages.slice(0, limit).map((m) => serializeMessage(m, true)),
      hasMore,
      total
    }

    perfLog('api.messages.GET', {
      mode: 'search',
      q,
      offset,
      limit,
      rows: body.messages.length,
      hasMore,
      payloadBytes: payloadBytes(body),
      ms: perfMs(startedAt)
    })

    return json(body)
  }

  const offset = parsePositiveInt(url.searchParams.get('offset'), 0)
  const requestedLimit = parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT)
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
  const mailboxSlug = url.searchParams.get('mailbox') ?? 'inbox'
  const threaded = url.searchParams.get('threaded') === '1'

  const mailboxPath = await resolveMailboxPath(mailboxSlug)

  if (threaded) {
    const [threads, total] = await Promise.all([
      listStoredThreads(mailboxPath, limit + 1, offset),
      countStoredThreads(mailboxPath)
    ])
    const hasMore = threads.length > limit
    const body = {
      messages: threads.slice(0, limit).map((m) => serializeMessage(m)),
      hasMore,
      total
    }

    perfLog('api.messages.GET', {
      mode: 'threaded',
      mailbox: mailboxPath,
      offset,
      limit,
      rows: body.messages.length,
      hasMore,
      payloadBytes: payloadBytes(body),
      ms: perfMs(startedAt)
    })

    return json(body)
  }

  const [messages, total] = await Promise.all([
    listStoredMessages(mailboxPath, limit + 1, offset),
    countStoredMessages(mailboxPath)
  ])
  const hasMore = messages.length > limit
  const body = {
    messages: messages.slice(0, limit).map((m) => serializeMessage(m)),
    hasMore,
    total
  }

  perfLog('api.messages.GET', {
    mode: 'list',
    mailbox: mailboxPath,
    offset,
    limit,
    rows: body.messages.length,
    hasMore,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return json(body)
}
