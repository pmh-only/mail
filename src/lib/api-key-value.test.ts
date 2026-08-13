import assert from 'node:assert/strict'
import { test, vi } from 'vitest'

const scryptFailure = vi.hoisted(() => ({ enabled: false }))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  const actualScrypt = actual.scrypt as (...args: unknown[]) => unknown

  return {
    ...actual,
    scrypt: (...args: unknown[]) => {
      const callback = args.at(-1)
      if (scryptFailure.enabled && typeof callback === 'function') {
        callback(new Error('scrypt failed'))
        return undefined
      }
      return actualScrypt(...args)
    }
  }
})
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  bearerApiKey,
  generateApiKeyValue,
  hashApiKey,
  rostackApiKey,
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
  assert.equal(
    bearerApiKey(new Headers({ authorization: 'bearer   pmail_value  ' })),
    'pmail_value'
  )
  assert.equal(bearerApiKey(new Headers({ authorization: 'Basic value' })), null)
  assert.equal(bearerApiKey(new Headers()), null)
})

test('reads case-insensitive rostack shared-token credentials', () => {
  assert.equal(
    rostackApiKey(new Headers({ authorization: 'Rostack-Token pmail_value' })),
    'pmail_value'
  )
  assert.equal(
    rostackApiKey(new Headers({ authorization: 'rostack-token pmail_value' })),
    'pmail_value'
  )
  assert.equal(rostackApiKey(new Headers()), null)
})

test('formats API key prefixes and rejects malformed stored hashes', async () => {
  assert.equal(apiKeyPrefix('pmail_abcdefghijklmnopqrstuvwxyz'), 'pmail_abcdefgh...')
  assert.equal(await verifyApiKeyHash('value', 'argon2$salt$hash'), false)
  assert.equal(await verifyApiKeyHash('value', 'scrypt$only-salt'), false)
  assert.equal(await verifyApiKeyHash('value', 'scrypt$salt$short'), false)
})

test('treats scrypt failures as an invalid stored hash', async () => {
  scryptFailure.enabled = true
  const storedHash = `scrypt$salt$${Buffer.alloc(64).toString('base64url')}`

  assert.equal(await verifyApiKeyHash('value', storedHash), false)

  scryptFailure.enabled = false
})
