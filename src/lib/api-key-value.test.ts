import assert from 'node:assert/strict'
import { test } from 'vitest'
import { API_KEY_PREFIX, bearerApiKey, generateApiKeyValue, hashApiKey } from './api-key-value.ts'

test('generates opaque prefixed API keys and hashes them deterministically', () => {
  const first = generateApiKeyValue()
  const second = generateApiKeyValue()
  assert.equal(first.startsWith(API_KEY_PREFIX), true)
  assert.notEqual(first, second)
  assert.match(hashApiKey(first), /^[a-f0-9]{64}$/)
  assert.equal(hashApiKey(first), hashApiKey(first))
})

test('reads only bearer authorization credentials', () => {
  assert.equal(bearerApiKey(new Headers({ authorization: 'Bearer pmail_value' })), 'pmail_value')
  assert.equal(bearerApiKey(new Headers({ authorization: 'Basic value' })), null)
  assert.equal(bearerApiKey(new Headers()), null)
})
