import assert from 'node:assert/strict'
import test from 'node:test'
import { changedReadStateCopies } from './read-state.ts'

test('updates every mailbox copy selected by Message-ID', () => {
  const rows = [
    { messageId: 'same', mailbox: 'Inbox', flags: '["\\\\Seen"]' },
    { messageId: 'same', mailbox: 'Inbox/Other', flags: '[]' },
    { messageId: 'other', mailbox: 'Inbox', flags: '[]' }
  ]

  const changed = changedReadStateCopies(rows, new Set(['same']), true)

  assert.deepEqual(
    changed.map((row) => [row.messageId, row.mailbox, row.flags]),
    [['same', 'Inbox/Other', '["\\\\Seen"]']]
  )
})
