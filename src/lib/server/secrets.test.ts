import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }))
vi.mock('$env/dynamic/private', () => ({ env: state.env }))

import {
  decryptSecret,
  encryptSecret,
  getSecretStorageStatus,
  isEncryptedSecret,
  isSecretEncryptionConfigured
} from './secrets'

beforeEach(() => {
  delete state.env.MAIL_SECRET_KEY
})

test('reports configuration and leaves values plaintext without a key', () => {
  assert.equal(isSecretEncryptionConfigured(), false)
  assert.deepEqual(getSecretStorageStatus(), {
    configured: false,
    text: 'Set MAIL_SECRET_KEY to encrypt newly saved mail, private keys, and authentication secrets.'
  })
  assert.equal(encryptSecret('plain'), 'plain')
  assert.equal(decryptSecret(null), '')
  assert.equal(decryptSecret(undefined), '')
  assert.equal(decryptSecret('plain'), 'plain')
  assert.equal(decryptSecret('enc:v1:a:b:c'), '')
})

test('encrypts, decrypts, and rejects malformed or tampered ciphertext', () => {
  state.env.MAIL_SECRET_KEY = ' key '
  assert.equal(isSecretEncryptionConfigured(), true)
  assert.equal(getSecretStorageStatus().configured, true)
  const encrypted = encryptSecret('classified')
  assert.equal(isEncryptedSecret(encrypted), true)
  assert.equal(isEncryptedSecret(null), false)
  assert.equal(encryptSecret(encrypted), encrypted)
  assert.equal(decryptSecret(encrypted), 'classified')
  assert.equal(decryptSecret('enc:v1:bad'), '')
  assert.equal(decryptSecret('enc:v1:AAAA:AAAA:AAAA'), '')
  assert.equal(decryptSecret(`${encrypted.slice(0, -2)}xx`), '')
})
