import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  returningResults: [] as unknown[][],
  inserts: [] as unknown[],
  updates: [] as unknown[]
}))

function query(result: unknown[]) {
  const chain = Promise.resolve(result) as Promise<unknown[]> & Record<string, unknown>
  for (const method of [
    'from',
    'orderBy',
    'where',
    'limit',
    'innerJoin',
    'set',
    'onConflictDoUpdate'
  ]) {
    chain[method] = () => chain
  }
  chain.returning = () => query(state.returningResults.shift() ?? [])
  return chain
}

vi.mock('./db', () => ({
  db: {
    select: () => query(state.selectResults.shift() ?? []),
    insert: () => {
      const chain = query([])
      chain.values = (values: unknown) => {
        state.inserts.push(values)
        return chain
      }
      return chain
    },
    update: () => {
      const chain = query([])
      chain.set = (values: unknown) => {
        state.updates.push(values)
        return chain
      }
      return chain
    },
    delete: () => query([])
  }
}))

import {
  ComposedMailboxConflictError,
  createComposedMailbox,
  deleteComposedMailbox,
  getComposedMailboxBySlug,
  getComposedMailboxUnreadCounts,
  isComposedMailboxConflict,
  listComposedMailboxes,
  updateComposedMailbox
} from './composed-mailboxes'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Work',
  slug: 'composed-work',
  icon: 'unknown',
  mailboxPaths: [' INBOX ', 'INBOX'],
  ...overrides
})

beforeEach(() => {
  state.selectResults.length = 0
  state.returningResults.length = 0
  state.inserts.length = 0
  state.updates.length = 0
})

test('lists normalized mailboxes, looks up valid prefixed slugs, and counts unread threads', async () => {
  state.selectResults.push([
    row(),
    row({ id: 2, name: 'Later', slug: 'composed-later', icon: 'archive', mailboxPaths: ['Sent'] })
  ])
  assert.deepEqual(await listComposedMailboxes(), [
    { id: 1, name: 'Work', slug: 'composed-work', icon: 'layers', mailboxPaths: ['INBOX'] },
    { id: 2, name: 'Later', slug: 'composed-later', icon: 'archive', mailboxPaths: ['Sent'] }
  ])
  assert.equal(await getComposedMailboxBySlug('inbox'), null)
  state.selectResults.push([row({ slug: 'composed-work' })])
  assert.equal((await getComposedMailboxBySlug('COMPOSED-WORK'))?.slug, 'composed-work')
  state.selectResults.push([])
  assert.equal(await getComposedMailboxBySlug('composed-missing'), null)
  state.selectResults.push([{ value: '2' }], [])
  assert.deepEqual(
    await getComposedMailboxUnreadCounts([
      { id: 1, name: 'Work', slug: 'composed-work', icon: 'layers', mailboxPaths: ['INBOX'] },
      { id: 2, name: 'Empty', slug: 'composed-empty', icon: 'layers', mailboxPaths: ['Empty'] }
    ]),
    { 'composed-work': 2, 'composed-empty': 0 }
  )
})

test('creates unique slugs and reports name or exhausted-slug conflicts', async () => {
  state.selectResults.push([], [{ id: 1 }], [])
  state.returningResults.push([
    row({ slug: 'composed-work-2', icon: 'layers', mailboxPaths: ['INBOX'] })
  ])
  assert.equal((await createComposedMailbox('Work', ['INBOX']))?.slug, 'composed-work-2')
  assert.deepEqual(state.inserts[0], {
    name: 'Work',
    slug: 'composed-work-2',
    icon: 'layers',
    mailboxPaths: ['INBOX']
  })
  state.selectResults.push([{ id: 2 }])
  await assert.rejects(createComposedMailbox('Work', []), ComposedMailboxConflictError)
  const reserved = new Set(
    Array.from({ length: 9_999 }, (_, index) => `composed-work${index ? `-${index + 1}` : ''}`)
  )
  state.selectResults.push([])
  await assert.rejects(createComposedMailbox('Work', [], reserved), /Could not create a unique/)
})

test('updates, deletes, and identifies conflict causes', async () => {
  state.selectResults.push([{ id: 2 }])
  await assert.rejects(updateComposedMailbox(1, 'Work', []), ComposedMailboxConflictError)
  state.selectResults.push([{ id: 1 }])
  state.returningResults.push([row({ name: 'Renamed', icon: 'sent', mailboxPaths: ['Sent'] })])
  assert.deepEqual(await updateComposedMailbox(1, 'Renamed', ['Sent'], 'sent'), {
    id: 1,
    name: 'Renamed',
    slug: 'composed-work',
    icon: 'sent',
    mailboxPaths: ['Sent']
  })
  assert.deepEqual(state.updates[0], {
    name: 'Renamed',
    icon: 'sent',
    mailboxPaths: ['Sent'],
    updatedAt: (state.updates[0] as { updatedAt: Date }).updatedAt
  })
  assert.ok((state.updates[0] as { updatedAt: unknown }).updatedAt instanceof Date)
  state.selectResults.push([])
  state.returningResults.push([])
  assert.equal(await updateComposedMailbox(1, 'Missing', []), null)
  state.returningResults.push([{ id: 1 }], [])
  assert.equal(await deleteComposedMailbox(1), true)
  assert.equal(await deleteComposedMailbox(2), false)
  assert.equal(isComposedMailboxConflict(new ComposedMailboxConflictError()), true)
  assert.equal(isComposedMailboxConflict({ code: '23505' }), true)
  assert.equal(isComposedMailboxConflict({ code: 'other' }), false)
  assert.equal(isComposedMailboxConflict(null), false)
})
