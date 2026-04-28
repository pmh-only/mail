import { env } from '$env/dynamic/private'
import OpenAI from 'openai'

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

  const outputText = response.output_text?.trim() ?? ''
  if (!outputText) throw new Error('OpenAI returned an empty response')

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
  const openaiStream = await client.responses.create({
    model,
    instructions,
    input: truncateInput(input),
    max_output_tokens: maxOutputTokens,
    store: false,
    stream: true
  })

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = ''

      try {
        for await (const event of openaiStream) {
          const delta = outputTextDelta(event)
          if (!delta) continue

          text += delta
          controller.enqueue(encoder.encode(delta))
        }

        const trimmed = text.trim()
        if (!trimmed) throw new Error('OpenAI returned an empty response')

        onComplete?.(trimmed)
        controller.close()
      } catch (error) {
        onError?.(error)
        controller.error(error)
      }
    }
  })
}
