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

test('normalizes invalid preference payloads and ignores invalid merge patches', () => {
  assert.deepEqual(normalizeMailboxPreferences(null), {
    order: [],
    hidden: [],
    collapsedAccounts: []
  })
  assert.deepEqual(
    mergeMailboxPreferences(
      { order: ['Inbox'], hidden: ['Spam'], collapsedAccounts: ['Primary'] },
      null
    ),
    { order: ['Inbox'], hidden: ['Spam'], collapsedAccounts: ['Primary'] }
  )
  assert.deepEqual(normalizeMailboxPreferences('legacy'), {
    order: [],
    hidden: [],
    collapsedAccounts: []
  })
  assert.deepEqual(
    mergeMailboxPreferences(
      { order: ['Inbox'], hidden: [], collapsedAccounts: [] },
      { order: 'not-an-array' }
    ),
    { order: [], hidden: [], collapsedAccounts: [] }
  )
})
