import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildImportanceInput,
  hasIncomingMailboxCopy,
  isIncomingMailbox,
  normalizeImportanceAddress,
  parseImportanceResults
} from './mail-importance.ts'

test('rejects malformed, duplicate, and incomplete importance results', () => {
  assert.deepEqual(
    [...parseImportanceResults('{"results":[{"id":1,"important":true}]}', [1])],
    [[1, true]]
  )
  assert.throws(() => parseImportanceResults('{}', [1]), /Invalid/)
  assert.throws(() => parseImportanceResults('{"results":[{"id":1}]}', [1]), /invalid/)
  assert.throws(
    () =>
      parseImportanceResults(
        '{"results":[{"id":1,"important":true},{"id":1,"important":false}]}',
        [1]
      ),
    /invalid/
  )
  assert.throws(() => parseImportanceResults('{"results":[]}', [1]), /omitted/)
  assert.throws(
    () => parseImportanceResults('{"results":[{"id":1.5,"important":true}]}', [1]),
    /unknown/
  )
})

test('recognizes incoming copies and normalizes mailbox addresses', () => {
  assert.equal(isIncomingMailbox('Sent Items', null), false)
  assert.equal(isIncomingMailbox('archive', '\\Drafts'), false)
  assert.equal(isIncomingMailbox('Newsletters', undefined), true)
  assert.equal(hasIncomingMailboxCopy([]), false)
  assert.equal(hasIncomingMailboxCopy([{ path: 'INBOX' }, { path: 'Drafts' }]), false)
  assert.equal(hasIncomingMailboxCopy([{ path: 'INBOX' }, { path: 'Archive' }]), true)
  assert.equal(hasIncomingMailboxCopy([{ path: 'Archive', specialUse: '\\All' }]), true)
  assert.equal(hasIncomingMailboxCopy([{ path: 'INBOX' }, { path: 'Sent copy' }]), false)
  assert.equal(normalizeImportanceAddress('  PERSON@EXAMPLE.COM  '), 'person@example.com')
  assert.equal(
    normalizeImportanceAddress('Display <one@example.com> ignored <two@example.com>'),
    'one@example.com'
  )
})

test('builds bounded input and rejects limits that cannot fit required data', () => {
  const message = {
    id: 1,
    subject: 'subject'.repeat(20),
    from: 'from'.repeat(20),
    to: 'to'.repeat(20),
    preview: 'preview'.repeat(20),
    excerpt: 'excerpt'.repeat(20)
  }
  const direct = buildImportanceInput([message], 10_000)
  assert.deepEqual(JSON.parse(direct), [message])

  const bounded = buildImportanceInput([message], 300)
  assert.ok(bounded.length <= 300)
  assert.ok(
    (JSON.parse(bounded) as Array<{ excerpt: string }>)[0].excerpt.length < message.excerpt.length
  )
  assert.throws(
    () => buildImportanceInput([{ ...message, subject: 'a' }], 10),
    /exceeds its size limit/
  )
})
