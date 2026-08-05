import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  API_KEY_PREFIX,
  bearerApiKey,
  generateApiKeyValue,
  hashApiKey,
  verifyApiKeyHash
} from './api-key-value.ts'

test('generates opaque prefixed API keys and hashes them with scrypt', async () => {
  const first = generateApiKeyValue()
  const second = generateApiKeyValue()
  assert.equal(first.startsWith(API_KEY_PREFIX), true)
  assert.notEqual(first, second)
  const hash = await hashApiKey(first)
  assert.match(hash, /^scrypt\$[^$]+\$[^$]+$/)
  assert.equal(await verifyApiKeyHash(first, hash), true)
  assert.equal(await verifyApiKeyHash(second, hash), false)
})

test('reads only bearer authorization credentials', () => {
  assert.equal(bearerApiKey(new Headers({ authorization: 'Bearer pmail_value' })), 'pmail_value')
  assert.equal(bearerApiKey(new Headers({ authorization: 'Basic value' })), null)
  assert.equal(bearerApiKey(new Headers()), null)
})
