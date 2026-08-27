import assert from 'node:assert/strict'
import { test } from 'vitest'
import { normalizeMailboxPrivacyMode, normalizeSharePrivacyMode } from './privacy-mode.ts'

test('normalizes mailbox privacy modes and migrates the remote-content preference', () => {
  assert.equal(normalizeMailboxPrivacyMode('only-text'), 'only-text')
  assert.equal(normalizeMailboxPrivacyMode('style-included'), 'style-included')
  assert.equal(normalizeMailboxPrivacyMode('full-featured'), 'full-featured')
  assert.equal(normalizeMailboxPrivacyMode('invalid', false), 'full-featured')
  assert.equal(normalizeMailboxPrivacyMode(undefined, true), 'style-included')
})

test('normalizes share privacy modes', () => {
  assert.equal(normalizeSharePrivacyMode('only-text'), 'only-text')
  assert.equal(normalizeSharePrivacyMode('style-included'), 'style-included')
  assert.equal(normalizeSharePrivacyMode('invalid'), 'style-included')
})
