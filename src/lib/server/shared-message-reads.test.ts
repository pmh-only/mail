import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SharedMessageReads } from './shared-message-reads.ts'

test('resolves registered share tokens and rejects unknown tokens', () => {
  const shares = new SharedMessageReads()
  shares.add('first-token', 'first-message')

  assert.equal(shares.getMessageId('first-token'), 'first-message')
  assert.equal(shares.getMessageId('unknown-token'), null)
})

test('counts a share token only after its first read', () => {
  const shares = new SharedMessageReads()
  shares.add('first-token', 'first-message')

  assert.equal(shares.count('first-message'), 0)
  shares.markRead('first-token')
  assert.equal(shares.count('first-message'), 1)

  shares.markRead('first-token')
  assert.equal(shares.count('first-message'), 1, 'repeat visits are idempotent')
})

test('counts each read share link and keeps messages isolated', () => {
  const shares = new SharedMessageReads()
  shares.add('first-token', 'first-message')
  shares.add('second-token', 'first-message')
  shares.add('third-token', 'second-message')

  shares.markRead('first-token')
  shares.markRead('second-token')
  shares.markRead('third-token')

  assert.equal(shares.count('first-message'), 2)
  assert.equal(shares.count('second-message'), 1)
  assert.equal(shares.count('unknown-message'), 0)
})

test('ignores unknown tokens and clears all share state', () => {
  const shares = new SharedMessageReads()
  shares.add('first-token', 'first-message')
  shares.markRead('first-token')
  shares.markRead('unknown-token')

  assert.equal(shares.count('first-message'), 1)
  shares.clear()
  assert.equal(shares.getMessageId('first-token'), null)
  assert.equal(shares.count('first-message'), 0)
})
