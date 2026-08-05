import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createThreadShareToken, getSharedMessagesByShareToken } from './mail.js'
import { resetDemoState } from './demo.js'

test('creates thread share token for multiple selected messages and retrieves them', async () => {
  resetDemoState()
  const messageIds = ['<demo-1@mail.local>', '<demo-2@mail.local>']
  const token = await createThreadShareToken(messageIds)

  assert.strictEqual(typeof token, 'string')
  assert.ok(token && token.length > 0)

  const shared = await getSharedMessagesByShareToken(token!)
  assert.strictEqual(shared.length, 2)
  const ids = shared.map((m) => m.messageId)
  assert.ok(ids.includes('<demo-1@mail.local>'))
  assert.ok(ids.includes('<demo-2@mail.local>'))
})

test('filters out unselected messages from the shared thread link', async () => {
  resetDemoState()
  const selectedIds = ['<demo-2@mail.local>']
  const token = await createThreadShareToken(selectedIds)

  const shared = await getSharedMessagesByShareToken(token!)
  assert.strictEqual(shared.length, 1)
  assert.strictEqual(shared[0].messageId, '<demo-2@mail.local>')
})

test('returns empty array for invalid or non-existent token', async () => {
  resetDemoState()
  const shared = await getSharedMessagesByShareToken('non-existent-token-12345')
  assert.deepStrictEqual(shared, [])
})

test('reuses existing share token when same message selection is shared again', async () => {
  resetDemoState()
  const messageIds = ['<demo-1@mail.local>', '<demo-2@mail.local>']
  const token1 = await createThreadShareToken(messageIds)
  const token2 = await createThreadShareToken(messageIds)

  assert.strictEqual(typeof token1, 'string')
  assert.strictEqual(token1, token2)
})

test('authorizes attachments and counts reads for all messages included in thread share', async () => {
  resetDemoState()
  const { countDemoSharedMessageReads, markDemoShareTokenAsRead } = await import('./demo.js')
  const messageIds = ['<demo-1@mail.local>', '<demo-2@mail.local>']
  const token = await createThreadShareToken(messageIds)

  assert.ok(token)
  markDemoShareTokenAsRead(token!)

  assert.strictEqual(countDemoSharedMessageReads('<demo-1@mail.local>'), 1)
  assert.strictEqual(countDemoSharedMessageReads('<demo-2@mail.local>'), 1)
})
