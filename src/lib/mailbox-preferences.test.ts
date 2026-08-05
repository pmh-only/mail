import assert from 'node:assert/strict'
import { test } from 'vitest'
import { mergeMailboxPreferences, normalizeMailboxPreferences } from './mailbox-preferences.ts'

test('defaults legacy mailbox preferences to no collapsed accounts', () => {
  assert.deepEqual(normalizeMailboxPreferences({ order: ['Inbox'], hidden: [] }), {
    order: ['Inbox'],
    hidden: [],
    collapsedAccounts: []
  })
})

test('normalizes persisted collapsed account names', () => {
  assert.deepEqual(
    normalizeMailboxPreferences({ collapsedAccounts: [' Primary ', 'Work', 'Work', '', 42] })
      .collapsedAccounts,
    ['Primary', 'Work']
  )
})

test('merges a collapse update without replacing other mailbox preferences', () => {
  assert.deepEqual(
    mergeMailboxPreferences(
      { order: ['Inbox', 'Archive'], hidden: ['Spam'], collapsedAccounts: [] },
      { collapsedAccounts: ['Primary'] }
    ),
    {
      order: ['Inbox', 'Archive'],
      hidden: ['Spam'],
      collapsedAccounts: ['Primary']
    }
  )
})
