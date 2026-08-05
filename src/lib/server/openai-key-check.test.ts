import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeOpenAIApiKey } from '../openai-api-key.js'

test('evaluates OpenAI API key presence correctly', () => {
  const emptyKey = normalizeOpenAIApiKey('')
  assert.strictEqual(Boolean(emptyKey), false)

  const validKey = normalizeOpenAIApiKey('sk-1234567890abcdef')
  assert.strictEqual(Boolean(validKey), true)
})
