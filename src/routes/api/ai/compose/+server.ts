import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { generateOpenAIText } from '$lib/server/openai'
import { logServerError } from '$lib/server/perf'
import { generateDemoAiCompose, isDemoModeEnabled } from '$lib/server/demo'
import { aiComposePreviewText, sanitizeAiComposeHtml } from '$lib/server/ai-compose-html'

const MAX_HTML_CHARS = 12_000
const REWRITE_MODES = ['concise', 'formal', 'friendly'] as const
type RewriteMode = (typeof REWRITE_MODES)[number]

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
  const html = sanitizeAiComposeHtml(stripCodeFence(value))
  if (!html) throw new Error('OpenAI returned an empty draft')
  return html
}

function composeResponse(value: string) {
  const html = normalizeHtml(value)
  return { html, text: aiComposePreviewText(html) }
}

function readRewriteMode(value: unknown): RewriteMode | '' {
  const rewriteMode = readString(value)
  if (!rewriteMode) return ''
  if (REWRITE_MODES.includes(rewriteMode as RewriteMode)) return rewriteMode as RewriteMode
  error(400, 'Rewrite mode must be concise, formal, or friendly.')
}

function rewriteModeInstruction(rewriteMode: RewriteMode | '') {
  if (rewriteMode === 'concise') {
    return 'Rewrite the current draft to be concise: remove redundancy, keep essential details, and preserve the original meaning.'
  }
  if (rewriteMode === 'formal') {
    return 'Rewrite the current draft in a formal, professional tone while preserving the original meaning.'
  }
  if (rewriteMode === 'friendly') {
    return 'Rewrite the current draft in a warm, friendly tone while preserving the original meaning.'
  }
  return 'If the current draft is rough notes, turn it into a complete email. If the current draft is already email text, improve clarity, tone, and structure without changing facts.'
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const mode = readString(body?.mode) || 'compose'
  const to = readString(body?.to)
  const cc = readString(body?.cc)
  const bcc = readString(body?.bcc)
  const subject = readString(body?.subject)
  const html = readString(body?.html)
  const rewriteMode = readRewriteMode(body?.rewriteMode)

  if (!subject && !html) {
    error(400, 'Subject or draft content is required for AI compose.')
  }

  if (isDemoModeEnabled()) {
    return json(composeResponse(generateDemoAiCompose({ mode, subject, html, to, rewriteMode })))
  }

  try {
    const output = await generateOpenAIText({
      instructions: [
        'You write polished email draft content.',
        'Return only HTML that can be inserted into a rich text email editor.',
        'Use simple tags only: p, br, ul, ol, li, strong, em, a.',
        'Do not include html, head, body, style, script, blockquote, or code fences.',
        'Match the language of the user draft or subject. If unclear, write in Korean.',
        rewriteModeInstruction(rewriteMode),
        'Do not invent names, commitments, dates, attachments, or facts not present in the input.'
      ].join(' '),
      input: [
        `Mode: ${mode}`,
        `Rewrite mode: ${rewriteMode || '(none)'}`,
        `To: ${to || '(empty)'}`,
        `Cc: ${cc || '(empty)'}`,
        `Bcc: ${bcc || '(empty)'}`,
        `Subject: ${subject || '(empty)'}`,
        `Current draft HTML:\n${html.slice(0, MAX_HTML_CHARS)}`
      ].join('\n\n'),
      maxOutputTokens: 1_200,
      maxInputChars: 18_000
    })

    return json(composeResponse(output))
  } catch (err) {
    logServerError('api.ai.compose', err, {
      mode,
      rewriteMode,
      hasSubject: Boolean(subject),
      hasHtml: Boolean(html)
    })
    error(502, err instanceof Error ? err.message : 'AI compose failed')
  }
}
