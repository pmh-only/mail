import assert from 'node:assert/strict'
import { test } from 'vitest'
import { changedReadStateCopies, unreadMessageRows } from './read-state.ts'

test('finds every unread message in a thread', () => {
  const rows = [
    { id: 1, flags: '["\\\\Seen"]' },
    { id: 2, flags: '[]' },
    { id: 3, flags: '["\\\\Flagged"]' }
  ]

  assert.deepEqual(
    unreadMessageRows(rows).map((row) => row.id),
    [2, 3]
  )
})

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
