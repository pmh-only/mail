import assert from 'node:assert/strict'
import { test } from 'vitest'
import { normalizeOpenAIApiKey } from './openai-api-key.ts'

test('makes copied OpenAI API keys safe for request headers', () => {
  const apiKey = normalizeOpenAIApiKey('│ sk-test-key │')
  const headers = new Headers({ authorization: `Bearer ${apiKey}` })

  assert.equal(apiKey, 'sk-test-key')
  assert.equal(headers.get('authorization'), 'Bearer sk-test-key')
})
