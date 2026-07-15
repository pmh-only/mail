import assert from 'node:assert/strict'
import test from 'node:test'
import { assignThreadKeys, orderThread } from './threading.ts'

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
