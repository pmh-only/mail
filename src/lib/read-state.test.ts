import assert from 'node:assert/strict'
import { test } from 'vitest'
import { changedReadStateCopies, isSeenFlags, unreadMessageRows } from './read-state.ts'

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

test('marks unread selected copies seen and preserves sent and draft copies as read', () => {
  const rows = [
    { messageId: 'one', mailbox: 'Inbox', flags: '[]', extra: true },
    { messageId: 'two', mailbox: 'Sent', flags: '["\\\\Seen"]' },
    { messageId: 'three', mailbox: 'Drafts', flags: '["\\\\Seen"]' },
    { messageId: 'four', mailbox: 'Inbox', flags: '["\\\\Seen"]' }
  ]

  assert.equal(isSeenFlags('["\\\\Seen"]'), true)
  assert.deepEqual(changedReadStateCopies(rows, new Set(['one', 'two', 'three', 'four']), true), [
    { messageId: 'one', mailbox: 'Inbox', flags: '["\\\\Seen"]', extra: true }
  ])
  assert.deepEqual(changedReadStateCopies(rows, new Set(['one', 'two', 'three', 'four']), false), [
    { messageId: 'four', mailbox: 'Inbox', flags: '[]' }
  ])
})
