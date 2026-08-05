import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  ensureSeenFlag,
  isAlwaysReadMailbox,
  normalizeMailboxFlags,
  pathToSlug,
  slugToPath
} from './mailbox.ts'

test('converts mailbox paths to case-insensitive URL slugs', () => {
  assert.equal(pathToSlug('[Gmail]/All Mail'), 'gmail~all-mail')
  assert.equal(pathToSlug('Projects  2026'), 'projects-2026')
})

test('resolves slugs and paths to the configured mailbox casing', () => {
  const mailboxes = [{ path: '[Gmail]/All Mail' }, { path: 'INBOX' }]

  assert.equal(slugToPath('GMAIL~ALL-MAIL', mailboxes), '[Gmail]/All Mail')
  assert.equal(slugToPath('inbox', mailboxes), 'INBOX')
  assert.equal(slugToPath('unknown', mailboxes), 'unknown')
})

test('keeps drafts and sent mailboxes read', () => {
  assert.equal(isAlwaysReadMailbox('Drafts'), true)
  assert.equal(isAlwaysReadMailbox('Sent Items'), true)
  assert.equal(isAlwaysReadMailbox('Unsent'), false)
  assert.deepEqual(ensureSeenFlag(['\\Flagged']), ['\\Flagged', '\\Seen'])
  assert.deepEqual(ensureSeenFlag(['\\Seen']), ['\\Seen'])
  assert.deepEqual(normalizeMailboxFlags('Sent', []), ['\\Seen'])
  assert.deepEqual(normalizeMailboxFlags('Inbox', ['\\Flagged']), ['\\Flagged'])
})
