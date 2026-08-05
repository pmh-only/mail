import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkApiRateLimit, checkApiSendRateLimit } from './api-rate-limit.ts'

test('limits external API requests per key and resets the window', () => {
  const key = `key-${Math.random()}`
  for (let index = 0; index < 120; index++) {
    assert.equal(checkApiRateLimit(key, 1_000), true)
  }
  assert.equal(checkApiRateLimit(key, 1_000), false)
  assert.equal(checkApiRateLimit(key, 61_000), true)
})

test('applies a stricter direct send limit', () => {
  const key = `send-${Math.random()}`
  for (let index = 0; index < 20; index++) {
    assert.equal(checkApiSendRateLimit(key, 1_000), true)
  }
  assert.equal(checkApiSendRateLimit(key, 1_000), false)
})
