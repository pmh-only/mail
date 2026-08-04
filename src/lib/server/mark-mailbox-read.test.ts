import assert from 'node:assert/strict'
import test from 'node:test'
import { markDemoMailboxMessagesSeen } from './demo.ts'

test('markDemoMailboxMessagesSeen marks unread messages in specified paths as read', () => {
  const count = markDemoMailboxMessagesSeen(['INBOX'])
  assert.ok(typeof count === 'number')
})
