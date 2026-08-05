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

test('reuses only links with the same message and thread membership', () => {
  const shares = new SharedMessageReads()
  shares.add('single', 'root')
  shares.add('empty-thread', 'root', [])
  shares.add('single-thread', 'root', ['root'])
  shares.add('thread', 'root', ['root', 'reply'])

  assert.deepEqual(shares.getMessageIds('thread'), ['root', 'reply'])
  assert.equal(shares.getMessageIds('missing'), null)
  assert.equal(shares.findExistingToken('root'), 'single')
  assert.equal(shares.findExistingToken('root', []), null)
  assert.equal(shares.findExistingToken('root', ['root']), 'single-thread')
  assert.equal(shares.findExistingToken('root', ['root', 'reply']), 'thread')
  assert.equal(shares.findExistingToken('root', ['reply', 'root']), null)
  assert.equal(shares.findExistingToken('other'), null)

  shares.markRead('thread')
  assert.equal(shares.count('reply'), 1)
})

test('does not reuse a multi-message thread for a single-message share', () => {
  const shares = new SharedMessageReads()
  shares.add('thread', 'root', ['root', 'reply'])
  shares.add('different-single', 'other-root', ['other-reply'])

  assert.equal(shares.findExistingToken('root'), null)
  assert.equal(shares.findExistingToken('other-root'), null)
})
