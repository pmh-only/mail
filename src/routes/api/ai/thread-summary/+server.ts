import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getMessagesInThread, resolveMailboxPath } from '$lib/server/mail'
import { createOpenAITextStream } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'
import { getTranslationTargetLanguage } from '$lib/server/preferences'
import { generateDemoThreadSummary, isDemoModeEnabled } from '$lib/server/demo'

const encoder = new TextEncoder()
const STREAM_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-cache, no-transform'
}
const MAX_MESSAGE_BODY_CHARS = 4_000

type ThreadSummaryCacheEntry = {
  fingerprint: string
  summary: string
  count: number
}

const threadSummaryCache = new Map<string, ThreadSummaryCacheEntry>()

type ThreadMessage = Awaited<ReturnType<typeof getMessagesInThread>>[number]

function trimBody(value: string | null | undefined) {
  const text = value?.trim()
  if (!text) return 'No body text available.'
  if (text.length <= MAX_MESSAGE_BODY_CHARS) return text
  return `${text.slice(0, MAX_MESSAGE_BODY_CHARS)}\n[Message body truncated]`
}

function threadSummaryInput(messages: ThreadMessage[]) {
  return messages
    .map((message, index) =>
      [
        `#${index + 1}`,
        `Subject: ${message.subject || '(no subject)'}`,
        `From: ${message.from || 'Unknown sender'}`,
        `To: ${message.to || ''}`,
        `Cc: ${message.cc || ''}`,
        `Received: ${message.receivedAt?.toISOString() ?? 'Unknown'}`,
        `Preview: ${message.preview || ''}`,
        `Body:\n${trimBody(message.textContent || message.preview)}`
      ].join('\n')
    )
    .join('\n\n---\n\n')
}

function threadFingerprint(messages: ThreadMessage[]) {
  return messages
    .map((message) =>
      [
        message.id,
        message.messageId,
        message.receivedAt?.toISOString() ?? '',
        message.subject,
        message.from,
        message.to,
        message.cc,
        message.preview,
        message.textContent?.length ?? 0
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

export const GET: RequestHandler = async ({ url, cookies }) => {
  const mailboxSlug = url.searchParams.get('mailbox') ?? 'inbox'
  const threadId = url.searchParams.get('threadId')
  const targetLanguage = getTranslationTargetLanguage(cookies)
  if (!threadId) error(400, 'Missing threadId')

  const mailboxPath = await resolveMailboxPath(mailboxSlug)
  const messages = await getMessagesInThread(threadId, mailboxPath)

  if (isDemoModeEnabled()) {
    const summary = generateDemoThreadSummary(mailboxPath, threadId, targetLanguage)
    if (!summary) error(404, 'Thread not found')

    return new Response(textStream(summary), {
      headers: {
        ...STREAM_HEADERS,
        'x-ai-cache': 'demo',
        'x-ai-thread-message-count': String(messages.length),
        'x-ai-mailbox': mailboxPath
      }
    })
  }

  const cacheKey = `${mailboxPath}:${threadId}:${targetLanguage}`
  const fingerprint = threadFingerprint(messages)

  if (messages.length === 0) {
    threadSummaryCache.delete(cacheKey)
    error(404, 'Thread not found')
  }

  const cached = threadSummaryCache.get(cacheKey)
  if (cached?.fingerprint === fingerprint) {
    return new Response(textStream(cached.summary), {
      headers: {
        ...STREAM_HEADERS,
        'x-ai-cache': 'hit',
        'x-ai-thread-message-count': String(cached.count),
        'x-ai-mailbox': mailboxPath
      }
    })
  }

  try {
    const stream = await createOpenAITextStream({
      instructions: [
        'You summarize an email conversation thread for the user.',
        `Write in ${targetLanguage}.`,
        'Start with a concise overall summary.',
        'Then include the timeline, current status, action items, unanswered questions, deadlines, and key participants when present.',
        'Use only facts from the provided messages. If something is unclear, say it is unclear.'
      ].join(' '),
      input: threadSummaryInput(messages),
      maxOutputTokens: 1_100,
      onComplete: (summary) => {
        threadSummaryCache.set(cacheKey, {
          fingerprint,
          summary,
          count: messages.length
        })
      },
      onError: (err) =>
        logServerError('api.ai.thread-summary.stream', err, {
          mailbox: mailboxPath,
          threadId
        })
    })

    return new Response(stream, {
      headers: {
        ...STREAM_HEADERS,
        'x-ai-cache': 'miss',
        'x-ai-thread-message-count': String(messages.length),
        'x-ai-mailbox': mailboxPath
      }
    })
  } catch (err) {
    logServerError('api.ai.thread-summary', err, { mailbox: mailboxPath, threadId })
    error(502, err instanceof Error ? err.message : 'Thread summary failed')
  }
}
