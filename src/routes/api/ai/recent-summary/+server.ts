import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listStoredMessages, resolveMailboxPath } from '$lib/server/mail'
import { createOpenAITextStream } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 25
const encoder = new TextEncoder()
const STREAM_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-cache, no-transform'
}

type RecentSummaryCacheEntry = {
  fingerprint: string
  summary: string
  count: number
}

const recentSummaryCache = new Map<string, RecentSummaryCacheEntry>()

function parseLimit(value: string | null) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function recentMailInput(messages: Awaited<ReturnType<typeof listStoredMessages>>) {
  return messages
    .map((message, index) =>
      [
        `#${index + 1}`,
        `Subject: ${message.subject || '(no subject)'}`,
        `From: ${message.from || 'Unknown sender'}`,
        `Received: ${message.receivedAt?.toISOString() ?? 'Unknown'}`,
        `Preview: ${message.preview || 'No preview'}`
      ].join('\n')
    )
    .join('\n\n')
}

function recentMailFingerprint(messages: Awaited<ReturnType<typeof listStoredMessages>>) {
  return messages
    .map((message) =>
      [
        message.id,
        message.messageId,
        message.receivedAt?.toISOString() ?? '',
        message.subject,
        message.from,
        message.preview
      ].join(':')
    )
    .join('|')
}

function textStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    }
  })
}

export const GET: RequestHandler = async ({ url }) => {
  const mailboxSlug = url.searchParams.get('mailbox') ?? 'inbox'
  const limit = parseLimit(url.searchParams.get('limit'))
  const mailboxPath = await resolveMailboxPath(mailboxSlug)
  const messages = await listStoredMessages(mailboxPath, limit, 0)
  const cacheKey = `${mailboxPath}:${limit}`
  const fingerprint = recentMailFingerprint(messages)

  if (messages.length === 0) {
    recentSummaryCache.delete(cacheKey)
    return new Response(textStream('요약할 최근 메일이 없습니다.'), { headers: STREAM_HEADERS })
  }

  const cached = recentSummaryCache.get(cacheKey)
  if (cached?.fingerprint === fingerprint) {
    return new Response(textStream(cached.summary), {
      headers: {
        ...STREAM_HEADERS,
        'x-ai-cache': 'hit',
        'x-ai-mail-count': String(cached.count),
        'x-ai-mailbox': mailboxPath
      }
    })
  }

  try {
    const stream = await createOpenAITextStream({
      instructions: [
        'You summarize a recent mailbox snapshot for a Korean-speaking user.',
        'Write in Korean.',
        'Use concise bullets grouped by priority when possible.',
        'Mention urgent requests, deadlines, decisions, and follow-up actions.',
        'Do not invent facts beyond the provided email metadata and previews.'
      ].join(' '),
      input: recentMailInput(messages),
      maxOutputTokens: 900,
      onComplete: (summary) => {
        recentSummaryCache.set(cacheKey, {
          fingerprint,
          summary,
          count: messages.length
        })
      },
      onError: (err) =>
        logServerError('api.ai.recent-summary.stream', err, { mailbox: mailboxPath, limit })
    })

    return new Response(stream, {
      headers: {
        ...STREAM_HEADERS,
        'x-ai-cache': 'miss',
        'x-ai-mail-count': String(messages.length),
        'x-ai-mailbox': mailboxPath
      }
    })
  } catch (err) {
    logServerError('api.ai.recent-summary', err, { mailbox: mailboxPath, limit })
    error(502, err instanceof Error ? err.message : 'Summary failed')
  }
}
