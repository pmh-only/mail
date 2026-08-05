import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  composedMailboxSlug,
  mergeComposedRows,
  normalizeComposedMailboxIcon,
  normalizeComposedMailboxName,
  normalizeComposedMailboxPaths,
  type ComposableMailRow
} from './composed-mailbox.ts'

type Row = ComposableMailRow & {
  id: number
  mailbox: string
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
  assert.equal(normalizeComposedMailboxName(null), '')
  assert.equal(normalizeComposedMailboxName(`  ${'a'.repeat(90)}  `), 'a'.repeat(80))
  assert.deepEqual(normalizeComposedMailboxPaths('INBOX'), [])
  assert.equal(composedMailboxSlug('--- A  B ---'), 'composed-a-b')
  assert.equal(composedMailboxSlug('a'.repeat(70)), `composed-${'a'.repeat(60)}`)
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

test('merges representative state, handles missing dates, and applies deterministic pagination', () => {
  const older = row(1, 'INBOX', '2026-01-01T00:00:00Z', {
    messageId: 'duplicate',
    threadStarred: true,
    hasThreadNote: true,
    hasImportantUnread: true
  })
  const newer = row(2, 'Archive', '2026-01-02T00:00:00Z', {
    messageId: 'duplicate',
    hasUnread: false,
    hasImportantUnread: false
  })
  const sameTimeHigherUid = row(4, 'INBOX', '2026-01-02T00:00:00Z', { messageId: 'same-time' })
  const sameTimeLowerUid = row(3, 'Archive', '2026-01-02T00:00:00Z', { messageId: 'same-time' })
  const undated = row(5, 'INBOX', '2026-01-01T00:00:00Z', {
    receivedAt: null,
    threadId: 'not-a-thread'
  })

  const result = mergeComposedRows(
    [
      [older, sameTimeLowerUid, undated],
      [newer, sameTimeHigherUid, sameTimeLowerUid]
    ],
    2,
    0
  )

  assert.deepEqual(
    result.map((item) => item.id),
    [4, 2]
  )
  assert.equal(result[1].threadStarred, true)
  assert.equal(result[1].hasThreadNote, true)
  assert.equal(result[1].hasImportantUnread, true)
  assert.equal(result[1].hasUnread, false)
  assert.deepEqual(mergeComposedRows([[older, newer]], 1, 1), [])
})

test('keeps the latest copy when dates are absent and omits undefined aggregate state', () => {
  const first = row(1, 'INBOX', '2026-01-01T00:00:00Z', { messageId: 'undated', receivedAt: null })
  const second = row(2, 'Archive', '2026-01-01T00:00:00Z', {
    messageId: 'undated',
    receivedAt: null
  })
  const result = mergeComposedRows([[first, second]], 10, 0)

  assert.equal(result[0].id, 2)
  assert.equal('hasUnread' in result[0], false)
  assert.equal('hasImportantUnread' in result[0], false)

  const important = mergeComposedRows(
    [
      [{ ...first, messageId: 'important', hasImportantUnread: false }],
      [{ ...second, messageId: 'important', hasImportantUnread: true }]
    ],
    10,
    0
  )
  assert.equal(important[0].hasImportantUnread, true)

  const tied = mergeComposedRows(
    [
      [
        { ...first, messageId: 'first', receivedAt: new Date('2026-01-01') },
        { ...second, messageId: 'second', receivedAt: new Date('2026-01-01') }
      ]
    ],
    10,
    0
  )
  assert.deepEqual(
    tied.map((item) => item.id),
    [2, 1]
  )

  const undatedTied = mergeComposedRows(
    [
      [
        { ...first, messageId: 'null-first' },
        { ...second, messageId: 'null-second' }
      ]
    ],
    10,
    0
  )
  assert.deepEqual(
    undatedTied.map((item) => item.id),
    [2, 1]
  )
})
