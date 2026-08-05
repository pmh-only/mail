import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'vitest'
import {
  createDemoFilter,
  createDemoShareToken,
  findDemoContactByEmail,
  generateDemoThreadActions,
  getDemoDraft,
  getDemoMessageByShareToken,
  getDemoSignatureProfiles,
  getDemoStoredMessageById,
  getDemoUnreadCount,
  listDemoFilters,
  listDemoStoredMessages,
  listDemoStoredThreads,
  saveDemoDraft,
  saveDemoSettings,
  searchDemoMessages,
  searchDemoMessagesByRegex,
  sendDemoMessage,
  resetDemoState,
  updateDemoFilter,
  upsertDemoContacts
} from './demo.ts'

beforeEach(resetDemoState)
afterEach(resetDemoState)

describe('demo branch behavior', () => {
  it('keeps explicit signature identifiers and creates complete defaults for sparse input', () => {
    saveDemoSettings({
      signatureProfiles: [{ id: 42, name: 'Explicit', html: '<p>Explicit</p>', isDefault: true }]
    })

    const draft = saveDemoDraft({ to: 1, cc: 1, bcc: 1, subject: 1, html: 1 }, '[]')
    const filterId = createDemoFilter({ target: 'Archive' })

    assert.equal(draft.id, 402)
    assert.deepEqual(
      getDemoSignatureProfiles().map(({ id, name }) => ({ id, name })),
      [{ id: 42, name: 'Explicit' }]
    )
    assert.deepEqual(getDemoDraft(draft.id), {
      ...getDemoDraft(draft.id),
      toAddr: '',
      cc: '',
      bcc: '',
      subject: '',
      html: ''
    })
    assert.deepEqual(getDemoStoredMessageById('not-a-number'), null)
    assert.equal(getDemoUnreadCount('Unknown'), 0)
    assert.equal(filterId, 503)

    updateDemoFilter(filterId, { target: 'Spam' })
    assert.equal(listDemoFilters().find((filter) => filter.id === filterId)?.target, 'Spam')
  })

  it('reports read-only mailbox threads as not unread and rejects unknown share tokens', () => {
    const sentThread = listDemoStoredThreads('Sent')

    assert.equal(sentThread.length, 1)
    assert.equal(sentThread[0].hasUnread, false)
    assert.equal(getDemoMessageByShareToken('unknown'), null)
    assert.ok(createDemoShareToken(103))
    assert.equal(findDemoContactByEmail('missing@example.com'), null)
  })

  it('exposes an empty-subject sent reply as the latest thread action', async () => {
    await sendDemoMessage({
      to: 'recipient@example.com',
      subject: '',
      inReplyTo: 'thread-demo-welcome',
      attachments: []
    })

    const action = generateDemoThreadActions('Sent', 'thread-demo-welcome')?.[0]
    assert.equal(action?.title, 'Follow up on ')
    assert.equal(action?.description, '')
  })

  it('applies contact defaults and keeps newer existing contact activity', async () => {
    await upsertDemoContacts([{ name: 'New', email: 'new@example.com' }])
    await upsertDemoContacts([
      { name: 'Alex Changed', email: 'alex@example.com', lastUsedAt: null }
    ])

    assert.equal(findDemoContactByEmail('new@example.com')?.useCount, 1)
    assert.equal(findDemoContactByEmail('alex@example.com')?.name, 'Alex Changed')
    assert.ok(findDemoContactByEmail('alex@example.com')?.lastUsedAt)
  })

  it('handles defensive message and filter edge cases', () => {
    const first = getDemoStoredMessageById(101)!
    const second = getDemoStoredMessageById(102)!
    const token = createDemoShareToken(first.id)!
    first.messageId = 'duplicate-message'
    second.messageId = 'duplicate-message'
    first.subject = 'duplicate'
    second.subject = 'duplicate'
    first.snoozedUntil = new Date(Date.now() + 60_000)

    assert.equal(
      listDemoStoredMessages('Inbox').some((message) => message.id === first.id),
      false
    )
    assert.ok(listDemoStoredMessages('Inbox', 100, 0, true).length < 7)
    assert.equal(searchDemoMessages('duplicate', 100, 0).length, 1)
    assert.equal(searchDemoMessagesByRegex('duplicate', 100).length, 1)
    assert.equal(getDemoMessageByShareToken(token), null)

    const filterId = createDemoFilter({})
    updateDemoFilter(filterId, { conditions: { match: 'all', conditions: [] } })
    assert.deepEqual(listDemoFilters().find((filter) => filter.id === filterId)?.conditions, {
      match: 'all',
      conditions: [],
      version: 1
    })

    assert.notEqual(saveDemoDraft({ id: 9999 }, '[]').id, 9999)
  })
})
