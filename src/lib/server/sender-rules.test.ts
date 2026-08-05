import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const selections: unknown[][] = []
  const inserted: unknown[] = []
  const deleted: unknown[] = []
  const moves: unknown[][] = []
  const refreshes: unknown[][] = []
  const table = (name: string) =>
    new Proxy({ name }, { get: (target, key) => `${target.name}.${String(key)}` })
  const query = (result: unknown[]) => {
    const value = Promise.resolve(result) as Promise<unknown[]> & Record<string, unknown>
    Object.assign(value, {
      from: () => value,
      where: () => value,
      orderBy: () => value
    })
    return value
  }
  const db = {
    select: vi.fn(() => query(selections.shift() ?? [])),
    insert: vi.fn(() => {
      const chain = {
        values(value: unknown) {
          inserted.push(value)
          return chain
        },
        onConflictDoUpdate: () => chain,
        returning: async () => selections.shift() ?? []
      }
      return chain
    }),
    delete: vi.fn(() => ({
      where(value: unknown) {
        deleted.push(value)
        return Promise.resolve()
      }
    }))
  }
  return {
    selections,
    inserted,
    deleted,
    moves,
    refreshes,
    mailboxes: [] as Array<{ name: string; path: string }>,
    db,
    mailMessage: table('message'),
    mailMessageMailbox: table('messageMailbox'),
    mailSenderRule: table('senderRule')
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  mailMessage: state.mailMessage,
  mailMessageMailbox: state.mailMessageMailbox,
  mailSenderRule: state.mailSenderRule
}))
vi.mock('drizzle-orm', () => ({
  desc: vi.fn((value) => `desc:${value}`),
  eq: vi.fn((left, right) => `eq:${left}:${right}`),
  inArray: vi.fn((left, right) => `in:${left}:${right.join('|')}`)
}))
vi.mock('./imap-operations', () => ({
  scheduleMoveMessage: vi.fn(async (...args) => state.moves.push(args))
}))
vi.mock('./mail', () => ({
  getImapMailboxes: vi.fn(async () => state.mailboxes),
  refreshThreadSummaries: vi.fn(async (...args) => state.refreshes.push(args))
}))

const senderRules = await import('./sender-rules.ts')

beforeEach(() => {
  state.selections.length = 0
  state.inserted.length = 0
  state.deleted.length = 0
  state.moves.length = 0
  state.refreshes.length = 0
  state.mailboxes.length = 0
  vi.clearAllMocks()
})

describe('sender rule validation and persistence', () => {
  test('validates types and normalizes display names, bare addresses, and arbitrary text', () => {
    assert.equal(senderRules.isSenderRuleType('block'), true)
    assert.equal(senderRules.isSenderRuleType('allow'), true)
    assert.equal(senderRules.isSenderRuleType('other'), false)
    assert.equal(senderRules.isSenderRuleType(1), false)
    assert.equal(senderRules.normalizeSender(' Ada <ADA@Example.Test> '), 'ada@example.test')
    assert.equal(senderRules.normalizeSender('Reach BOB@example.test now'), 'bob@example.test')
    assert.equal(senderRules.normalizeSender('  Sender Name  '), 'sender name')
  })

  test('lists, adds, and deletes rules', async () => {
    state.selections.push([{ id: 1 }], [{ id: 9 }], [], [])
    assert.deepEqual(await senderRules.listSenderRules(), [{ id: 1 }])
    assert.equal(await senderRules.addSenderRule('block', ' Ada@Example.Test '), 9)
    assert.deepEqual(state.inserted, [
      { type: 'block', sender: 'Ada@Example.Test', normalizedSender: 'ada@example.test' }
    ])
    assert.equal(await senderRules.addSenderRule('allow', 'nobody@example.test'), null)
    assert.equal(await senderRules.addSenderRule('allow', '  '), null)
    await senderRules.deleteSenderRule(3)
    assert.deepEqual(state.deleted, ['eq:senderRule.id:3'])
  })
})

describe('applying sender rules', () => {
  test('returns early for empty ids, missing rules, and allow-only rules', async () => {
    assert.deepEqual(await senderRules.applySenderRulesToMessages([]), new Set())
    state.selections.push([], [{ type: 'allow', normalizedSender: 'ada@example.test' }])
    assert.deepEqual(await senderRules.applySenderRulesToMessages(['one']), new Set())
    assert.deepEqual(await senderRules.applySenderRulesToMessages(['one']), new Set())
  })

  test('does not block when no trash mailbox is available', async () => {
    state.selections.push(
      [{ type: 'block', normalizedSender: 'ada@example.test' }],
      [{ messageId: 'one', from: 'ada@example.test', threadKey: 'thread' }]
    )
    assert.deepEqual(await senderRules.applySenderRulesToMessages(['one']), new Set())
  })

  test('moves blocked sender messages, respects allow rules, and refreshes affected mailboxes', async () => {
    state.mailboxes.push({ name: 'Trash', path: '[Gmail]/Trash' })
    state.selections.push(
      [
        { type: 'block', normalizedSender: 'blocked@example.test' },
        { type: 'allow', normalizedSender: 'allowed@example.test' }
      ],
      [
        { messageId: 'blocked', from: 'Blocked <BLOCKED@example.test>', threadKey: 'thread-a' },
        { messageId: 'allowed', from: 'allowed@example.test', threadKey: 'thread-b' },
        { messageId: 'other', from: 'other@example.test', threadKey: 'thread-c' }
      ],
      [
        { id: 1, uid: 11, mailbox: 'Inbox' },
        { id: 2, uid: 12, mailbox: '[Gmail]/Trash' },
        { id: 3, uid: 13, mailbox: 'Archive' }
      ]
    )
    assert.deepEqual(
      await senderRules.applySenderRulesToMessages(['blocked', 'allowed', 'other']),
      new Set(['blocked'])
    )
    assert.deepEqual(state.moves, [
      [11, 'Inbox', '[Gmail]/Trash'],
      [13, 'Archive', '[Gmail]/Trash']
    ])
    assert.deepEqual(state.deleted, ['eq:messageMailbox.id:1', 'eq:messageMailbox.id:3'])
    assert.deepEqual(state.refreshes, [
      ['Inbox', new Set(['thread-a'])],
      ['Archive', new Set(['thread-a'])]
    ])
  })

  test('reports blocked messages already in trash without refreshing a mailbox', async () => {
    state.mailboxes.push({ name: 'Trash', path: 'Trash' })
    state.selections.push(
      [{ type: 'block', normalizedSender: 'blocked@example.test' }],
      [{ messageId: 'blocked', from: 'blocked@example.test', threadKey: 'thread' }],
      [{ id: 1, uid: 1, mailbox: 'Trash' }]
    )
    assert.deepEqual(
      await senderRules.applySenderRulesToMessages(['blocked']),
      new Set(['blocked'])
    )
    assert.deepEqual(state.refreshes, [])
  })
})
