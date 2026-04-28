import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getStoredMessageById } from '$lib/server/mail'
import { generateOpenAIText } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'

const MAX_SEGMENTS = 300

type TranslationCacheEntry = {
  fingerprint: string
  translations: string[]
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
  return JSON.stringify(
    segments.map((text, index) => ({
      index,
      text
    }))
  )
}

function parseTranslationItems(value: string, expectedLength: number) {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  const parsed = JSON.parse(trimmed) as unknown
  const items =
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { translations?: unknown }).translations)
      ? (parsed as { translations: unknown[] }).translations
      : Array.isArray(parsed)
        ? parsed
        : null

  if (!items) throw new Error('Translation response did not contain translations')

  const translations = Array<string | null>(expectedLength).fill(null)

  items.forEach((item, fallbackIndex) => {
    if (typeof item === 'string') {
      if (fallbackIndex < translations.length) translations[fallbackIndex] = item
      return
    }

    if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
      const rawIndex = (item as { index?: unknown }).index
      const index =
        typeof rawIndex === 'number' && Number.isInteger(rawIndex) ? rawIndex : fallbackIndex
      if (index >= 0 && index < translations.length) {
        translations[index] = (item as { text: string }).text
      }
      return
    }

    throw new Error('Translation response contained an invalid item')
  })

  return translations
}

function buildTranslations(translated: string, segments: string[]) {
  const parsed = parseTranslationItems(translated, segments.length)
  return parsed.map((translation, index) => translation ?? segments[index])
}

function translationSchema() {
  return {
    type: 'json_schema' as const,
    name: 'email_text_segment_translations',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        translations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'integer' },
              text: { type: 'string' }
            },
            required: ['index', 'text']
          }
        }
      },
      required: ['translations']
    }
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const id = body?.id
  const segments = normalizeSegments(body?.segments)
  const targetLanguage =
    typeof body?.targetLanguage === 'string' && body.targetLanguage.trim()
      ? body.targetLanguage.trim()
      : 'Korean'

  if (typeof id !== 'number' && typeof id !== 'string') {
    error(400, 'Message id is required')
  }

  const message = await getStoredMessageById(id)
  if (!message) error(404, 'Message not found')

  if (segments.length === 0) {
    error(400, 'Translation segments are required')
  }

  const translationFormat = body?.format === 'html' ? 'html' : 'text'
  const cacheKey = `${message.id}:${targetLanguage}:${translationFormat}`
  const fingerprint = messageFingerprint(message, segments)
  const cached = translationCache.get(cacheKey)

  if (cached?.fingerprint === fingerprint) {
    return json(
      { translations: cached.translations },
      {
        headers: {
          'x-ai-cache': 'hit',
          'x-ai-message-id': message.messageId,
          'x-ai-translation-format': translationFormat
        }
      }
    )
  }

  try {
    const translated = await generateOpenAIText({
      instructions: [
        `Translate each JSON item text into ${targetLanguage}.`,
        'Return JSON matching the schema: translations is an array of objects with the original index and translated text.',
        'Keep every input index exactly once. Do not merge, split, omit, reorder, or add items.',
        'Do not translate URLs, email addresses, code-like identifiers, or product/model names unless natural language requires it.',
        'Do not add explanations or Markdown fences.'
      ].join(' '),
      input: translationInput(segments),
      maxInputChars: 80_000,
      maxOutputTokens: Math.min(Math.max(segments.join('\n').length * 2, 1200), 12_000),
      textConfig: {
        format: translationSchema()
      }
    })

    const translations = buildTranslations(translated, segments)

    translationCache.set(cacheKey, {
      fingerprint,
      translations
    })

    return json(
      { translations },
      {
        headers: {
          'x-ai-cache': 'miss',
          'x-ai-message-id': message.messageId,
          'x-ai-translation-format': translationFormat
        }
      }
    )
  } catch (err) {
    logServerError('api.ai.translate', err, { id })
    error(502, err instanceof Error ? err.message : 'Translation failed')
  }
}
