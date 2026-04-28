import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getStoredMessageById } from '$lib/server/mail'
import { createOpenAITextStream, generateOpenAITextFromStream } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'

const MAX_SEGMENTS = 300
const TRANSLATION_PROMPT_VERSION = 'from-to-v2'
const encoder = new TextEncoder()
const STREAM_HEADERS = {
  'content-type': 'application/x-ndjson; charset=utf-8',
  'cache-control': 'no-cache, no-transform'
}

type TranslationCacheEntry = {
  fingerprint: string
  translations: string[]
}

type TranslationStreamPayload = {
  translations?: string[]
  resolved?: number
  done: boolean
  error?: string
}

const translationCache = new Map<string, TranslationCacheEntry>()

function normalizeSegments(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS)
}

function messageFingerprint(
  message: NonNullable<Awaited<ReturnType<typeof getStoredMessageById>>>,
  segments: string[]
) {
  return [
    message.id,
    message.messageId,
    message.receivedAt?.toISOString() ?? '',
    message.subject,
    message.from,
    segments.join('\u0000')
  ].join(':')
}

function translationInput(segments: string[]) {
  return JSON.stringify(segments.map((from) => ({ from, to: '' })))
}

function translationInstructions(targetLanguage: string) {
  return [
    `Work as a translation editor and translate each item's from text into ${targetLanguage}.`,
    'Return a JSON array of objects with exactly two string keys: from and to.',
    'Copy every from value exactly once and fill to with the translated text.',
    'Keep item order unchanged. Do not merge, split, omit, reorder, or add items.',
    'If a segment should stay unchanged, copy the original text into to.',
    'Do not translate URLs, email addresses, code-like identifiers, or product/model names unless natural language requires it.',
    'Do not add explanations or Markdown fences.'
  ].join(' ')
}

function translationMaxOutputTokens(segments: string[]) {
  return Math.min(Math.max(segments.join('\n').length * 3, 1200), 12_000)
}

function nextEmptyIndex(translations: Array<string | null>) {
  return translations.findIndex((translation) => translation === null)
}

function normalizeTranslationJson(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
}

function extractJsonArrayCandidate(value: string) {
  const start = value.indexOf('[')
  if (start < 0) return value

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = start; index < value.length; index += 1) {
    const char = value[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }

      if (char === '\\') {
        escaping = true
        continue
      }

      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '[' || char === '{') {
      depth += 1
      continue
    }

    if (char === ']' || char === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }

  return value.slice(start)
}

function repairIncompleteJson(value: string) {
  let repaired = value.trimEnd().replace(/,\s*$/, '')
  let inString = false
  let escaping = false
  const stack: string[] = []

  for (let index = 0; index < repaired.length; index += 1) {
    const char = repaired[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }

      if (char === '\\') {
        escaping = true
        continue
      }

      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '[' || char === '{') {
      stack.push(char)
      continue
    }

    if (char === ']' && stack[stack.length - 1] === '[') {
      stack.pop()
      continue
    }

    if (char === '}' && stack[stack.length - 1] === '{') {
      stack.pop()
    }
  }

  if (/:\s*$/.test(repaired)) repaired += '""'

  if (inString) {
    if (escaping) repaired += '\\'
    repaired += '"'
  }

  repaired = repaired.replace(/,\s*([}\]])/g, '$1')

  while (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/, '')
    repaired += stack.pop() === '{' ? '}' : ']'
  }

  return repaired
}

function tryParseTranslationPayload(value: string) {
  const normalized = normalizeTranslationJson(value)
  const candidate = extractJsonArrayCandidate(normalized)

  for (const attempt of [candidate, repairIncompleteJson(candidate)]) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      if (Array.isArray(parsed)) return parsed
    } catch {
      continue
    }
  }

  return null
}

function parseTranslationPayload(value: string) {
  const parsed = tryParseTranslationPayload(value)
  if (parsed && parsed.length > 0) return parsed
  throw new Error('Translation response did not contain a valid translation array')
}

function translationSlots(items: unknown[], segments: string[]) {
  const translations = Array<string | null>(segments.length).fill(null)
  const sourceIndexes = new Map<string, number[]>()

  segments.forEach((segment, index) => {
    const indexes = sourceIndexes.get(segment)
    if (indexes) {
      indexes.push(index)
      return
    }

    sourceIndexes.set(segment, [index])
  })

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return

    const source =
      typeof (item as { from?: unknown }).from === 'string' ? (item as { from: string }).from : ''
    const translation =
      typeof (item as { to?: unknown }).to === 'string' ? (item as { to: string }).to : null

    if (translation === null || translation.trim() === '') return

    const indexes = source ? sourceIndexes.get(source) : null
    if (indexes?.length) {
      const index = indexes.shift()!
      translations[index] = translation
      return
    }

    const fallbackIndex = nextEmptyIndex(translations)
    if (fallbackIndex >= 0) translations[fallbackIndex] = translation
  })

  return translations
}

function resolvedTranslationCount(translations: Array<string | null>) {
  return translations.reduce((count, translation) => count + (translation === null ? 0 : 1), 0)
}

function translationResult(items: unknown[], segments: string[]) {
  const slots = translationSlots(items, segments)
  return {
    resolved: resolvedTranslationCount(slots),
    translations: slots.map((translation, index) => translation ?? segments[index])
  }
}

function buildPartialTranslations(translated: string, segments: string[]) {
  const parsed = tryParseTranslationPayload(translated)
  if (!parsed) return null

  const result = translationResult(parsed, segments)
  return result.resolved > 0 ? result : null
}

function buildTranslations(translated: string, segments: string[]) {
  const parsed = parseTranslationPayload(translated)
  const result = translationResult(parsed, segments)

  if (result.resolved === 0) {
    throw new Error('Translation response did not contain any usable translations')
  }

  return result.translations
}

function responseHeaders(
  cacheStatus: 'hit' | 'miss',
  messageId: string,
  translationFormat: string
) {
  return {
    'x-ai-cache': cacheStatus,
    'x-ai-message-id': messageId,
    'x-ai-translation-format': translationFormat
  }
}

function streamPayload(payload: TranslationStreamPayload) {
  return `${JSON.stringify(payload)}\n`
}

function textStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    }
  })
}

function streamResponse(payload: TranslationStreamPayload, headers: Record<string, string>) {
  return new Response(textStream(streamPayload(payload)), { headers })
}

function sameTranslations(left: string[] | null, right: string[]) {
  if (!left || left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

async function createStreamingTranslationResponse({
  cacheKey,
  fingerprint,
  id,
  messageId,
  segments,
  targetLanguage,
  translationFormat
}: {
  cacheKey: string
  fingerprint: string
  id: number | string
  messageId: string
  segments: string[]
  targetLanguage: string
  translationFormat: string
}) {
  const aiStream = await createOpenAITextStream({
    instructions: translationInstructions(targetLanguage),
    input: translationInput(segments),
    maxInputChars: 80_000,
    maxOutputTokens: translationMaxOutputTokens(segments)
  })

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = aiStream.getReader()
        const decoder = new TextDecoder()
        let raw = ''
        let lastResolved = 0
        let lastTranslations: string[] | null = null

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (!value) continue

            raw += decoder.decode(value, { stream: true })
            const partial = buildPartialTranslations(raw, segments)
            if (!partial || partial.resolved < lastResolved) continue
            if (
              partial.resolved === lastResolved &&
              sameTranslations(lastTranslations, partial.translations)
            ) {
              continue
            }

            lastResolved = partial.resolved
            lastTranslations = partial.translations
            controller.enqueue(
              encoder.encode(
                streamPayload({
                  translations: partial.translations,
                  resolved: partial.resolved,
                  done: false
                })
              )
            )
          }

          raw += decoder.decode()
          const translations = buildTranslations(raw, segments)

          translationCache.set(cacheKey, {
            fingerprint,
            translations
          })

          controller.enqueue(
            encoder.encode(
              streamPayload({
                translations,
                resolved: translations.length,
                done: true
              })
            )
          )
          controller.close()
        } catch (err) {
          logServerError('api.ai.translate.stream', err, { id })
          controller.enqueue(
            encoder.encode(
              streamPayload({
                error: err instanceof Error ? err.message : 'Translation failed',
                done: true
              })
            )
          )
          controller.close()
        }
      }
    }),
    {
      headers: {
        ...STREAM_HEADERS,
        ...responseHeaders('miss', messageId, translationFormat)
      }
    }
  )
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const id = body?.id
  const segments = normalizeSegments(body?.segments)
  const targetLanguage =
    typeof body?.targetLanguage === 'string' && body.targetLanguage.trim()
      ? body.targetLanguage.trim()
      : 'Korean'
  const streamRequested = body?.stream === true

  if (typeof id !== 'number' && typeof id !== 'string') {
    error(400, 'Message id is required')
  }

  const message = await getStoredMessageById(id)
  if (!message) error(404, 'Message not found')

  if (segments.length === 0) {
    error(400, 'Translation segments are required')
  }

  const translationFormat = body?.format === 'html' ? 'html' : 'text'
  const cacheKey = `${message.id}:${targetLanguage}:${translationFormat}:${TRANSLATION_PROMPT_VERSION}`
  const fingerprint = messageFingerprint(message, segments)
  const cached = translationCache.get(cacheKey)
  const headers = responseHeaders('hit', message.messageId, translationFormat)

  if (cached?.fingerprint === fingerprint) {
    if (streamRequested) {
      return streamResponse(
        {
          translations: cached.translations,
          resolved: cached.translations.length,
          done: true
        },
        { ...STREAM_HEADERS, ...headers }
      )
    }

    return json(
      { translations: cached.translations },
      {
        headers
      }
    )
  }

  try {
    if (streamRequested) {
      return await createStreamingTranslationResponse({
        cacheKey,
        fingerprint,
        id,
        messageId: message.messageId,
        segments,
        targetLanguage,
        translationFormat
      })
    }

    const translated = await generateOpenAITextFromStream({
      instructions: translationInstructions(targetLanguage),
      input: translationInput(segments),
      maxInputChars: 80_000,
      maxOutputTokens: translationMaxOutputTokens(segments)
    })

    const translations = buildTranslations(translated, segments)

    translationCache.set(cacheKey, {
      fingerprint,
      translations
    })

    return json(
      { translations },
      {
        headers: responseHeaders('miss', message.messageId, translationFormat)
      }
    )
  } catch (err) {
    logServerError('api.ai.translate', err, { id })
    error(502, err instanceof Error ? err.message : 'Translation failed')
  }
}
