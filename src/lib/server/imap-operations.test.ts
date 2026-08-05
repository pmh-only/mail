import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as Array<{ values?: unknown; conflict?: unknown }> }))

vi.mock('./db', () => ({
  db: {
    insert: vi.fn(() => {
      const call: { values?: unknown; conflict?: unknown } = {}
      state.calls.push(call)
      const query = {
        values: vi.fn((values: unknown) => {
          call.values = values
          return query
        }),
        onConflictDoUpdate: vi.fn((conflict: unknown) => {
          call.conflict = conflict
          return Promise.resolve()
        })
      }
      return query
    })
  }
}))

vi.mock('../imap-sync', () => ({
  seenJob: vi.fn((uid: number, mailbox: string, seen: boolean) => ({
    type: seen ? 'mark_read' : 'mark_unread',
    dedupeKey: `seen:${mailbox}:${uid}`
  }))
}))

import {
  scheduleAddFlag,
  scheduleMarkRead,
  scheduleMarkUnread,
  scheduleMoveMessage
} from './imap-operations'

beforeEach(() => {
  state.calls.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

test('schedules seen-state jobs with a shared dedupe key', async () => {
  await scheduleMarkRead(7, 'INBOX')
  await scheduleMarkUnread(8, 'Archive')

  assert.deepEqual(state.calls[0].values, {
    type: 'mark_read',
    mailbox: 'INBOX',
    uid: 7,
    targetMailbox: null,
    status: 'pending',
    dedupeKey: 'seen:INBOX:7',
    attemptCount: 0,
    availableAt: new Date('2026-01-01T00:00:00Z'),
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  })
  assert.deepEqual(state.calls[1].values as { type: string; dedupeKey: string }, {
    ...(state.calls[1].values as object),
    type: 'mark_unread',
    dedupeKey: 'seen:Archive:8'
  })
  assert.ok(state.calls.every((call) => call.conflict))
})

test('schedules move and flag jobs with their mutable conflict fields', async () => {
  await scheduleMoveMessage(9, 'INBOX', 'Archive')
  await scheduleAddFlag(10, 'INBOX', '$important')

  assert.deepEqual(state.calls[0].values, {
    type: 'move',
    mailbox: 'INBOX',
    uid: 9,
    targetMailbox: 'Archive',
    status: 'pending',
    dedupeKey: 'move:INBOX:9',
    attemptCount: 0,
    availableAt: new Date('2026-01-01T00:00:00Z'),
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  })
  assert.deepEqual(state.calls[1].values, {
    type: 'add_flag',
    mailbox: 'INBOX',
    uid: 10,
    targetMailbox: '$important',
    status: 'pending',
    dedupeKey: 'add_flag:INBOX:10:$important',
    attemptCount: 0,
    availableAt: new Date('2026-01-01T00:00:00Z'),
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  })
})
