import assert from 'node:assert/strict'
import { test } from 'vitest'
import { countDemoStoredMessages, markDemoMailboxMessagesSeen, resetDemoState } from './demo.ts'

test('markDemoMailboxMessagesSeen marks only target mailbox unread messages as read', () => {
  resetDemoState()

  const initialTargetUnread = countDemoStoredMessages('Inbox', true)
  const initialOtherUnread = countDemoStoredMessages('Archive', true)

  assert.ok(initialTargetUnread > 0, 'target mailbox should have initial unread messages')

  const count = markDemoMailboxMessagesSeen(['Inbox'])

  assert.equal(
    count,
    initialTargetUnread,
    'returned count should match initial unread count of target mailbox'
  )
  assert.equal(
    countDemoStoredMessages('Inbox', true),
    0,
    'target mailbox unread count should be 0 after mark-read'
  )
  assert.equal(
    countDemoStoredMessages('Archive', true),
    initialOtherUnread,
    'messages outside target mailbox must remain unchanged'
  )
})

test('markDemoMailboxMessagesSeen returns 0 when there are no unread messages to update', () => {
  resetDemoState()

  // First call marks all as read
  markDemoMailboxMessagesSeen(['Inbox'])
  assert.equal(countDemoStoredMessages('Inbox', true), 0)

  // Second call on already read mailbox should update 0 messages
  const count = markDemoMailboxMessagesSeen(['Inbox'])
  assert.equal(count, 0, 'second mark-read call should return 0')
})

test('markDemoMailboxMessagesSeen supports composed multi-path scopes', () => {
  resetDemoState()

  const inboxUnread = countDemoStoredMessages('Inbox', true)
  const archiveUnread = countDemoStoredMessages('Archive', true)
  const spamUnread = countDemoStoredMessages('Spam', true)

  const count = markDemoMailboxMessagesSeen(['Inbox', 'Archive'])

  assert.equal(
    count,
    inboxUnread + archiveUnread,
    'should return total marked read across composed target paths'
  )
  assert.equal(countDemoStoredMessages('Inbox', true), 0)
  assert.equal(countDemoStoredMessages('Archive', true), 0)
  assert.equal(
    countDemoStoredMessages('Spam', true),
    spamUnread,
    'non-target mailbox remains untouched'
  )
})
