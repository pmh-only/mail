import assert from 'node:assert/strict'
import { test } from 'vitest'
import { assignThreadKeys, baseSubject, orderThread, referenceCandidates } from './threading.ts'

const message = (
  messageId: string,
  subject: string,
  references: string | null = null,
  inReplyTo: string | null = null,
  receivedAt = new Date('2026-01-01')
) => ({ messageId, subject, references, inReplyTo, receivedAt })

test('threads References-only mail and repairs out-of-order ancestry', () => {
  const keys = assignThreadKeys([
    message('child', 'Re: Topic', 'root parent'),
    message('parent', 'Re: Topic', 'root', 'root'),
    message('root', 'Topic')
  ])

  assert.equal(keys.get('root'), 'root')
  assert.equal(keys.get('parent'), 'root')
  assert.equal(keys.get('child'), 'root')
})

test('uses reply-like subject only when reference headers are absent', () => {
  const keys = assignThreadKeys([
    message('root', 'Topic'),
    message('reply', 'Re: Topic'),
    message('unrelated', 'Topic')
  ])

  assert.equal(keys.get('reply'), 'root')
  assert.equal(keys.get('unrelated'), 'unrelated')
})

test('orders branches as a chronological parent-child tree', () => {
  const ordered = orderThread([
    message('second-branch', 'Re: Topic', 'root', 'root', new Date('2026-01-04')),
    message('nested', 'Re: Topic', 'root first-branch', 'first-branch', new Date('2026-01-03')),
    message('root', 'Topic', null, null, new Date('2026-01-01')),
    message('first-branch', 'Re: Topic', 'root', 'root', new Date('2026-01-02'))
  ])

  assert.deepEqual(
    ordered.map(({ messageId, threadDepth }) => [messageId, threadDepth]),
    [
      ['root', 0],
      ['first-branch', 1],
      ['nested', 2],
      ['second-branch', 1]
    ]
  )
})

test('normalizes repeated reply prefixes and filters self references', () => {
  assert.deepEqual(baseSubject(' [List] Re[2]: Fwd: Topic (fwd) '), {
    value: 'topic',
    isReply: true
  })
  assert.deepEqual(baseSubject('  Topic  '), { value: 'topic', isReply: false })
  assert.deepEqual(referenceCandidates(message('self', 'Topic', ' self  parent ', null)), [
    'parent'
  ])
  assert.deepEqual(referenceCandidates(message('child', 'Topic', null, 'parent')), ['parent'])
})

test('uses missing ancestors and handles circular reference chains deterministically', () => {
  const keys = assignThreadKeys([
    message('orphan', 'Re: Topic', 'missing'),
    message('a', 'Topic', 'b'),
    message('b', 'Topic', 'a')
  ])
  assert.equal(keys.get('orphan'), 'missing')
  assert.equal(keys.get('a'), 'a')
  assert.equal(keys.get('b'), 'a')
})

test('keeps unmatched reply subjects separate and orders disconnected cycles once', () => {
  const keys = assignThreadKeys([message('reply', 'Re: New topic')])
  assert.equal(keys.get('reply'), 'reply')

  const ordered = orderThread([
    message('b', 'Re: Topic', 'a', 'a', new Date('2026-01-02')),
    message('a', 'Topic', 'b', 'b', new Date('2026-01-01')),
    message('orphan', 'Topic', 'missing', null, new Date('2026-01-03'))
  ])
  assert.deepEqual(
    ordered.map(({ messageId, threadDepth }) => [messageId, threadDepth]),
    [
      ['orphan', 0],
      ['a', 0],
      ['b', 1]
    ]
  )
})

test('uses deterministic IDs when timestamps are absent and references fall back to known ancestors', () => {
  const messages = [
    { ...message('z', 'Topic'), receivedAt: null },
    { ...message('a', 'Re: Topic', 'missing z'), inReplyTo: 'missing', receivedAt: null }
  ]
  assert.equal(assignThreadKeys(messages).get('a'), 'missing')
  assert.deepEqual(
    orderThread(messages).map(({ messageId }) => messageId),
    ['z', 'a']
  )
})
