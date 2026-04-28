import { env } from '$env/dynamic/private'
import OpenAI from 'openai'
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses'

const DEFAULT_MODEL = 'gpt-4.1-mini'
const MAX_INPUT_CHARS = 14_000
const encoder = new TextEncoder()

type OpenAIConfig = { apiKey: string; model: string } | { missing: string[] }

function getOpenAIConfig(): OpenAIConfig {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) return { missing: ['OPENAI_API_KEY'] }

  return {
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL
  }
}

function truncateInput(value: string) {
  if (value.length <= MAX_INPUT_CHARS) return value
  return `${value.slice(0, MAX_INPUT_CHARS)}\n\n[Input truncated]`
}

function truncateInputAt(value: string, maxInputChars = MAX_INPUT_CHARS) {
  if (value.length <= maxInputChars) return value
  return `${value.slice(0, maxInputChars)}\n\n[Input truncated]`
}

function outputTextDelta(event: unknown) {
  if (!event || typeof event !== 'object') return ''
  const record = event as Record<string, unknown>
  if (record.type !== 'response.output_text.delta') return ''
  return typeof record.delta === 'string' ? record.delta : ''
}

function outputTextDone(event: unknown) {
  if (!event || typeof event !== 'object') return ''
  const record = event as Record<string, unknown>
  if (record.type !== 'response.output_text.done') return ''
  return typeof record.text === 'string' ? record.text : ''
}

function responseDone(event: unknown) {
  if (!event || typeof event !== 'object') return null
  const record = event as Record<string, unknown>
  if (record.type !== 'response.completed' && record.type !== 'response.incomplete') return null
  return record.response && typeof record.response === 'object'
    ? (record.response as OpenAIResponse)
    : null
}

function outputTextFromItems(response: OpenAIResponse) {
  const textParts: string[] = []

  for (const item of response.output) {
    if (item.type !== 'message') continue

    for (const content of item.content) {
      if (content.type === 'output_text') {
        textParts.push(content.text)
      }
    }
  }

  return textParts.join('')
}

function refusalFromItems(response: OpenAIResponse) {
  const refusals: string[] = []

  for (const item of response.output) {
    if (item.type !== 'message') continue

    for (const content of item.content) {
      if (content.type === 'refusal' && content.refusal.trim()) {
        refusals.push(content.refusal.trim())
      }
    }
  }

  return refusals.join(' ')
}

function responseDiagnostic(response: OpenAIResponse | null) {
  if (!response) return ''
  if (response.error) return `: ${response.error.message}`

  const refusal = refusalFromItems(response)
  if (refusal) return `: ${refusal}`

  const reason = response.incomplete_details?.reason
  if (reason) return `: response incomplete (${reason})`

  if (response.status && response.status !== 'completed')
    return `: response status ${response.status}`

  return ''
}

function extractOutputText(response: OpenAIResponse) {
  return (response.output_text || outputTextFromItems(response)).trim()
}

type OpenAITextParams = {
  instructions: string
  input: string
  maxOutputTokens?: number
  maxInputChars?: number
  textConfig?: Parameters<OpenAI['responses']['create']>[0]['text']
}

function createClientConfig() {
  const config = getOpenAIConfig()
  if ('missing' in config) {
    throw new Error(`Missing ${config.missing.join(', ')}`)
  }

  return {
    client: new OpenAI({ apiKey: config.apiKey }),
    model: config.model
  }
}

export async function generateOpenAIText({
  instructions,
  input,
  maxOutputTokens = 900,
  maxInputChars,
  textConfig
}: OpenAITextParams) {
  const { client, model } = createClientConfig()

  const response = await client.responses.create({
    model,
    instructions,
    input: truncateInputAt(input, maxInputChars),
    max_output_tokens: maxOutputTokens,
    store: false,
    text: textConfig
  })

  const outputText = extractOutputText(response)
  if (!outputText) {
    throw new Error(`OpenAI returned an empty response${responseDiagnostic(response)}`)
  }

  return outputText
}

export async function createOpenAITextStream({
  instructions,
  input,
  maxOutputTokens = 900,
  onComplete,
  onError
}: OpenAITextParams & {
  onComplete?: (text: string) => void
  onError?: (error: unknown) => void
}) {
  const { client, model } = createClientConfig()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = ''
      let finalResponse: OpenAIResponse | null = null

      try {
        const openaiStream = await client.responses.create({
          model,
          instructions,
          input: truncateInput(input),
          max_output_tokens: maxOutputTokens,
          store: false,
          stream: true
        })

        for await (const event of openaiStream) {
          finalResponse = responseDone(event) ?? finalResponse

          const delta = outputTextDelta(event)
          if (delta) {
            text += delta
            controller.enqueue(encoder.encode(delta))
            continue
          }

          const doneText = outputTextDone(event)
          if (doneText && !text) {
            text = doneText
            controller.enqueue(encoder.encode(doneText))
          }
        }

        const trimmed = text.trim()
        if (!trimmed) {
          const fallback = finalResponse ? extractOutputText(finalResponse) : ''
          if (!fallback) {
            throw new Error(`OpenAI returned an empty response${responseDiagnostic(finalResponse)}`)
          }

          text = fallback
          controller.enqueue(encoder.encode(fallback))
        }

        onComplete?.(text.trim())
        controller.close()
      } catch (error) {
        onError?.(error)
        controller.error(error)
      }
    }
  })
}
