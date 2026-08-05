import { expect, test } from 'vitest'
import { normalizeOpenAIApiKey } from '../openai-api-key.js'

test('evaluates OpenAI API key presence correctly', () => {
  const emptyKey = normalizeOpenAIApiKey('')
  expect(Boolean(emptyKey)).toBe(false)

  const validKey = normalizeOpenAIApiKey('sk-1234567890abcdef')
  expect(Boolean(validKey)).toBe(true)
})
