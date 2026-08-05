import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  composedMailboxSlug,
  mergeComposedRows,
  normalizeComposedMailboxIcon,
  normalizeComposedMailboxName,
  normalizeComposedMailboxPaths
} from './composed-mailbox.ts'

type Row = {
  id: number
  messageId: string
  mailbox: string
  uid: number
  receivedAt: Date
  threadId?: string
  threadCount?: number
  threadPinned?: boolean
  hasUnread?: boolean
}

function row(id: number, mailbox: string, receivedAt: string, values: Partial<Row> = {}): Row {
  return {
    id,
    messageId: `message-${id}`,
    mailbox,
    uid: id,
    receivedAt: new Date(receivedAt),
    ...values
  }
}

test('normalizes composed mailbox definitions and creates stable URL slugs', () => {
  assert.equal(normalizeComposedMailboxName('  Work   and personal  '), 'Work and personal')
  assert.deepEqual(normalizeComposedMailboxPaths([' INBOX ', 'Sent', 'INBOX', '', 42]), [
    'INBOX',
    'Sent'
  ])
  assert.equal(composedMailboxSlug('Équipe + Personal'), 'composed-equipe-personal')
  assert.equal(composedMailboxSlug('郵件'), 'composed-mailbox')
})

test('normalizes composed mailbox icons', () => {
  assert.equal(normalizeComposedMailboxIcon('archive'), 'archive')
  assert.equal(normalizeComposedMailboxIcon('spam'), 'spam')
  assert.equal(normalizeComposedMailboxIcon('drafts'), 'drafts')
  assert.equal(normalizeComposedMailboxIcon('sent'), 'sent')
  assert.equal(normalizeComposedMailboxIcon('unknown'), 'layers')
  assert.equal(normalizeComposedMailboxIcon(null), 'layers')
})

test('deduplicates copies and orders the combined message view globally', () => {
  const duplicateOlder = row(1, 'INBOX', '2026-01-01T10:00:00Z', {
    messageId: 'shared',
    hasUnread: true
  })
  const duplicateNewer = row(2, 'Archive', '2026-01-01T10:00:00Z', {
    messageId: 'shared',
    uid: 20,
    hasUnread: false
  })
  const newest = row(3, 'Sent', '2026-01-03T10:00:00Z')
  const middle = row(4, 'INBOX', '2026-01-02T10:00:00Z')

  const result = mergeComposedRows(
    [
      [duplicateOlder, middle],
      [duplicateNewer, newest]
    ],
    2,
    1
  )
  assert.deepEqual(
    result.map((item) => item.id),
    [4, 2]
  )
  assert.equal(result[1].hasUnread, true, 'unread state survives a newer read copy')
})

test('merges matching threads and carries aggregate state from every mailbox', () => {
  const inbox = row(1, 'INBOX', '2026-01-01T10:00:00Z', {
    threadId: 'thread-1',
    threadCount: 1,
    hasUnread: true
  })
  const sent = row(2, 'Sent', '2026-01-02T10:00:00Z', {
    threadId: 'thread-1',
    threadCount: 1,
    threadPinned: true,
    hasUnread: false
  })
  const other = row(3, 'INBOX', '2026-01-03T10:00:00Z', {
    threadId: 'thread-2',
    threadCount: 1
  })

  const result = mergeComposedRows([[inbox, other], [sent]], 10, 0)
  assert.equal(result.length, 2)
  assert.equal(result[0].threadId, 'thread-1', 'pinned merged thread sorts first')
  assert.equal(result[0].id, 2, 'latest representative is retained')
  assert.equal(result[0].hasUnread, true)
})
