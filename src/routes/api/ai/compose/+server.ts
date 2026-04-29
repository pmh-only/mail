import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { generateOpenAIText } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'
import { generateDemoAiCompose, isDemoModeEnabled } from '$lib/server/demo'

const MAX_HTML_CHARS = 12_000

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function normalizeHtml(value: string) {
  const html = stripCodeFence(value)
  if (!html) throw new Error('OpenAI returned an empty draft')
  return html
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const mode = readString(body?.mode) || 'compose'
  const to = readString(body?.to)
  const cc = readString(body?.cc)
  const bcc = readString(body?.bcc)
  const subject = readString(body?.subject)
  const html = readString(body?.html)

  if (!subject && !html) {
    error(400, 'Subject or draft content is required for AI compose.')
  }

  if (isDemoModeEnabled()) {
    return json({ html: generateDemoAiCompose({ mode, subject, html, to }) })
  }

  try {
    const output = await generateOpenAIText({
      instructions: [
        'You write polished email draft content.',
        'Return only HTML that can be inserted into a rich text email editor.',
        'Use simple tags only: p, br, ul, ol, li, strong, em, a.',
        'Do not include html, head, body, style, script, blockquote, or code fences.',
        'Match the language of the user draft or subject. If unclear, write in Korean.',
        'If the current draft is rough notes, turn it into a complete email.',
        'If the current draft is already email text, improve clarity, tone, and structure without changing facts.',
        'Do not invent names, commitments, dates, attachments, or facts not present in the input.'
      ].join(' '),
      input: [
        `Mode: ${mode}`,
        `To: ${to || '(empty)'}`,
        `Cc: ${cc || '(empty)'}`,
        `Bcc: ${bcc || '(empty)'}`,
        `Subject: ${subject || '(empty)'}`,
        `Current draft HTML:\n${html.slice(0, MAX_HTML_CHARS)}`
      ].join('\n\n'),
      maxOutputTokens: 1_200,
      maxInputChars: 18_000
    })

    return json({ html: normalizeHtml(output) })
  } catch (err) {
    logServerError('api.ai.compose', err, {
      mode,
      hasSubject: Boolean(subject),
      hasHtml: Boolean(html)
    })
    error(502, err instanceof Error ? err.message : 'AI compose failed')
  }
}
