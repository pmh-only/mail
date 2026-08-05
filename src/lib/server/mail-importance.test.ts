import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildImportanceInput,
  hasIncomingMailboxCopy,
  isIncomingMailbox,
  normalizeImportanceAddress,
  parseImportanceResults
} from '../mail-importance.ts'

test('validates complete structured importance results', () => {
  const results = parseImportanceResults(
    JSON.stringify({
      results: [
        { id: 10, important: true },
        { id: 11, important: false }
      ]
    }),
    [10, 11]
  )

  assert.deepEqual(
    [...results],
    [
      [10, true],
      [11, false]
    ]
  )
  assert.throws(
    () => parseImportanceResults('{"results":[{"id":10,"important":true}]}', [10, 11]),
    /omitted/
  )
  assert.throws(
    () =>
      parseImportanceResults(
        '{"results":[{"id":10,"important":true},{"id":99,"important":false}]}',
        [10, 11]
      ),
    /unknown/
  )
})

test('keeps oversized classifier batches as valid bounded JSON', () => {
  const input = buildImportanceInput(
    Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      subject: '"subject\\'.repeat(500),
      from: 'sender@example.com'.repeat(100),
      to: 'recipient@example.com'.repeat(100),
      preview: 'preview'.repeat(500),
      excerpt: '\u0000\\"content'.repeat(2_000)
    })),
    13_000
  )

  assert.ok(input.length <= 13_000)
  assert.deepEqual(
    (JSON.parse(input) as Array<{ id: number }>).map((message) => message.id),
    [1, 2, 3, 4]
  )
})

test('excludes sent, draft, spam, and trash mailbox copies', () => {
  assert.equal(isIncomingMailbox('INBOX', '\\Inbox'), true)
  assert.equal(isIncomingMailbox('Billing', null), true)
  assert.equal(isIncomingMailbox('[Gmail]/Sent Mail', '\\Sent'), false)
  assert.equal(isIncomingMailbox('Drafts', null), false)
  assert.equal(isIncomingMailbox('Junk Email', '\\Junk'), false)
  assert.equal(isIncomingMailbox('Deleted Items', '\\Trash'), false)
  assert.equal(
    hasIncomingMailboxCopy([
      { path: 'All Mail', specialUse: '\\All' },
      { path: 'Sent', specialUse: '\\Sent' }
    ]),
    false
  )
  assert.equal(
    hasIncomingMailboxCopy([
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Trash', specialUse: '\\Trash' }
    ]),
    true
  )
  assert.equal(normalizeImportanceAddress('Sender <Sender@Example.com>'), 'sender@example.com')
})
