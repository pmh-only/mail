import assert from 'node:assert/strict'
import test from 'node:test'
import {
  condstoreChangedSince,
  draftAppendMatches,
  draftDeleteJob,
  mailboxStatusUnchanged,
  isCondstoreRejection,
  reconcileMailboxRows,
  draftJobDedupeKey,
  newUidRange,
  previousDraftUidToDelete,
  seenJob,
  shouldUseStatusFastPath,
  syncBatchComplete,
  uidValidityChanged
} from './imap-sync.ts'

test('builds a bounded UID range from UIDNEXT', () => {
  assert.equal(newUidRange(10, 14), '11:13')
  assert.equal(newUidRange(10, 11), null)
  assert.equal(newUidRange(0, 1), null)
})

test('dedupes autosaves and only deletes a previous draft from the same UID epoch', () => {
  assert.equal(draftJobDedupeKey(12), 'draft:12')
  assert.equal(
    previousDraftUidToDelete(
      { mailbox: 'Drafts', uid: 5, uidValidity: 3 },
      { mailbox: 'Drafts', uid: 6, uidValidity: 3 }
    ),
    5
  )
  assert.equal(
    previousDraftUidToDelete(
      { mailbox: 'Drafts', uid: 5, uidValidity: 2 },
      { mailbox: 'Drafts', uid: 6, uidValidity: 3 }
    ),
    null
  )
})

test('creates one durable cleanup identity for a remote draft copy', () => {
  const now = new Date('2026-07-15T00:00:00.000Z')
  assert.deepEqual(draftDeleteJob(12, 'Drafts', 7, 3, now), {
    type: 'delete_draft',
    mailbox: 'Drafts',
    uid: 7,
    uidValidity: 3,
    draftId: 12,
    status: 'pending',
    dedupeKey: 'draft-delete:12:7',
    attemptCount: 0,
    availableAt: now,
    createdAt: now,
    updatedAt: now
  })
})

test('keeps one remote copy after an ambiguous APPEND retry', () => {
  assert.deepEqual(draftAppendMatches([20, 18, 19]), { uid: 20, duplicates: [18, 19] })
  assert.deepEqual(draftAppendMatches([]), { uid: null, duplicates: [] })
})

test('only treats a previously adopted UIDVALIDITY change as a reset', () => {
  assert.equal(uidValidityChanged(null, 42), false)
  assert.equal(uidValidityChanged(42, 42), false)
  assert.equal(uidValidityChanged(41, 42), true)
})

test('does not accept a partially stored UID batch', () => {
  assert.equal(syncBatchComplete(3, 3), true)
  assert.equal(syncBatchComplete(3, 2), false)
})

test('read and unread intents replace the same queued job', () => {
  assert.deepEqual(seenJob(7, 'Inbox', true), {
    type: 'mark_read',
    dedupeKey: 'seen:Inbox:7'
  })
  assert.deepEqual(seenJob(7, 'Inbox', false), {
    type: 'mark_unread',
    dedupeKey: 'seen:Inbox:7'
  })
})

test('uses STATUS as a fast path only with matching identity, UIDNEXT and MODSEQ', () => {
  const state = { lastUid: 9, uidValidity: 3, highestModseq: 20n }
  assert.equal(
    mailboxStatusUnchanged(state, { uidNext: 10, uidValidity: 3n, highestModseq: 20n }),
    true
  )
  assert.equal(
    mailboxStatusUnchanged(state, { uidNext: 10, uidValidity: 3n, highestModseq: 21n }),
    false
  )
  const status = { uidNext: 10, uidValidity: 3n, highestModseq: 20n }
  assert.equal(shouldUseStatusFastPath(false, true, state, status), true)
  assert.equal(shouldUseStatusFastPath(true, true, state, status), false)
})

test('falls back to full metadata when CONDSTORE is missing or rejected', () => {
  assert.equal(condstoreChangedSince(true, false, 20n), 20n)
  assert.equal(condstoreChangedSince(false, false, 20n), undefined)
  assert.equal(condstoreChangedSince(true, true, 20n), undefined)
  assert.equal(isCondstoreRejection(new Error('BAD CHANGEDSINCE is not supported')), true)
  assert.equal(isCondstoreRejection(new Error('database connection failed')), false)
})

test('reconciles remote flags and deletes while protecting local intents', () => {
  const changes = reconcileMailboxRows(
    [
      { uid: 1, flags: '[]' },
      { uid: 2, flags: '[]' },
      { uid: 3, flags: '[]' }
    ],
    new Set([1, 3]),
    new Map([[1, '["\\\\Seen"]']]),
    new Set([3])
  )
  assert.deepEqual(changes, [
    { row: { uid: 1, flags: '[]' }, action: 'flags', flags: '["\\\\Seen"]' },
    { row: { uid: 2, flags: '[]' }, action: 'delete' }
  ])
})
