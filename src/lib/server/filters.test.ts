import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const selections: unknown[][] = []
  const updates: unknown[] = []
  const deleted: unknown[] = []
  const marks: unknown[][] = []
  const flags: unknown[][] = []
  const moves: unknown[][] = []
  const refreshes: unknown[][] = []
  const table = (name: string) =>
    new Proxy({ name }, { get: (target, key) => `${target.name}.${String(key)}` })
  const query = (result: unknown[]) => {
    const value = Promise.resolve(result) as Promise<unknown[]> & Record<string, unknown>
    Object.assign(value, {
      from: () => value,
      where: () => value,
      orderBy: () => value,
      innerJoin: () => value,
      limit: async () => result
    })
    return value
  }
  const db = {
    select: vi.fn(() => query(selections.shift() ?? [])),
    update: vi.fn(() => {
      const chain = {
        set(value: unknown) {
          updates.push(value)
          return chain
        },
        where: () => Promise.resolve()
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
    updates,
    deleted,
    marks,
    flags,
    moves,
    refreshes,
    mailboxes: [] as Array<{ name: string; path: string }>,
    blocked: new Set<string>(),
    db,
    mailFilter: table('filter'),
    mailMessage: table('message'),
    mailMessageMailbox: table('messageMailbox')
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  mailFilter: state.mailFilter,
  mailMessage: state.mailMessage,
  mailMessageMailbox: state.mailMessageMailbox
}))
vi.mock('drizzle-orm', () => ({
  desc: vi.fn((x) => x),
  eq: vi.fn((x, y) => `eq:${x}:${y}`),
  inArray: vi.fn((x, y) => `in:${x}:${y.join('|')}`)
}))
vi.mock('$lib/filter-conditions', () => ({
  normalizeFilterConditions: vi.fn((conditions) => conditions)
}))
vi.mock('./sender-rules', () => ({ applySenderRulesToMessages: vi.fn(async () => state.blocked) }))
vi.mock('./imap-operations', () => ({
  scheduleMarkRead: vi.fn(async (...x) => state.marks.push(x)),
  scheduleAddFlag: vi.fn(async (...x) => state.flags.push(x)),
  scheduleMoveMessage: vi.fn(async (...x) => state.moves.push(x))
}))
vi.mock('./mail', () => ({
  getImapMailboxes: vi.fn(async () => state.mailboxes),
  refreshThreadSummaries: vi.fn(async (...x) => state.refreshes.push(x))
}))

const filters = await import('./filters.ts')
const condition = (field: string, operator: string, value: string) => ({
  version: 1 as const,
  match: 'all' as const,
  conditions: [{ field, operator, value }]
})
const filter = (
  action: string,
  conditions: unknown = condition('from', 'contains', 'ada'),
  target: string | null = null
) => ({
  id: 1,
  action,
  conditions,
  field: 'from',
  operator: 'contains',
  value: 'ada',
  target,
  enabled: true,
  sortOrder: 1
})
const message = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'one',
  from: 'Ada <ada@example.test>',
  to: 'bob@example.test',
  subject: 'Status report',
  cc: 'team@example.test',
  threadKey: 'thread',
  ...overrides
})

beforeEach(() => {
  for (const value of [
    state.selections,
    state.updates,
    state.deleted,
    state.marks,
    state.flags,
    state.moves,
    state.refreshes,
    state.mailboxes
  ])
    value.length = 0
  state.blocked.clear()
  vi.clearAllMocks()
})

describe('filter matching and previews', () => {
  test('matches all fields, operators, any sets, invalid fields, and applies the limit', async () => {
    const rows = [message({ id: 1, mailbox: 'Inbox', receivedAt: new Date() })]
    state.selections.push(rows, rows, rows, rows, rows, rows, rows)
    assert.equal(
      (await filters.previewFilterMatches(filter('star', condition('from', 'contains', 'ADA'))))[0]
        .id,
      1
    )
    assert.equal(
      (
        await filters.previewFilterMatches(
          filter('star', condition('to', 'equals', 'bob@example.test'))
        )
      ).length,
      1
    )
    assert.equal(
      (
        await filters.previewFilterMatches(
          filter('star', condition('subject', 'starts_with', 'status'))
        )
      ).length,
      1
    )
    assert.equal(
      (await filters.previewFilterMatches(filter('star', condition('cc', 'ends_with', '.test'))))
        .length,
      1
    )
    assert.equal(
      (
        await filters.previewFilterMatches(
          filter('star', {
            version: 1,
            match: 'any',
            conditions: [
              { field: 'from', operator: 'equals', value: 'no' },
              { field: 'subject', operator: 'contains', value: 'report' }
            ]
          }),
          0
        )
      ).length,
      0
    )
    assert.equal(
      (
        await filters.previewFilterMatches(
          filter('star', { version: 1, match: 'all', conditions: [] })
        )
      ).length,
      0
    )
    assert.equal(
      (await filters.previewFilterMatches(filter('star', condition('missing', 'missing', 'x'))))
        .length,
      0
    )
  })
})

describe('running filters', () => {
  test('handles empty input, blocked messages, missing filters, and existing-message runs', async () => {
    await filters.runFiltersOnMessages([])
    state.blocked.add('one')
    await filters.runFiltersOnMessages(['one'])
    state.blocked.clear()
    state.selections.push([])
    await filters.runFiltersOnMessages(['one'])
    state.selections.push([filter('mark_read', condition('from', 'equals', 'nobody'))], [message()])
    await filters.runFiltersOnMessages(['one'])
    state.selections.push([filter('unknown')], [message()])
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [{ messageId: 'one' }, { messageId: 'one' }, { messageId: 'two' }],
      [],
      []
    )
    assert.equal(await filters.runFiltersOnExistingMessages(), 2)
  })

  test('marks unread matches read and leaves already-read entries unchanged', async () => {
    state.selections.push(
      [filter('mark_read')],
      [message()],
      [
        { id: 1, uid: 1, mailbox: 'Inbox', flags: '[]' },
        { id: 2, uid: 2, mailbox: 'Inbox', flags: '["\\\\Seen"]' }
      ]
    )
    await filters.runFiltersOnMessages(['one'])
    assert.deepEqual(state.updates, [{ flags: '["\\\\Seen"]' }])
    assert.deepEqual(state.marks, [[1, 'Inbox']])
  })

  test('stars and labels messages without duplicating flags or accepting blank labels', async () => {
    state.selections.push(
      [filter('star')],
      [message()],
      [
        { id: 1, uid: 1, mailbox: 'Inbox', flags: '[]' },
        { id: 2, uid: 2, mailbox: 'Inbox', flags: '["\\\\Flagged"]' }
      ]
    )
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [filter('label', condition('from', 'contains', 'ada'), 'Work Items')],
      [message()],
      [{ id: 3, uid: 3, mailbox: 'Inbox', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [filter('label', condition('from', 'contains', 'ada'), '   ')],
      [message()]
    )
    await filters.runFiltersOnMessages(['one'])
    assert.deepEqual(state.flags, [
      [1, 'Inbox', '\\Flagged'],
      [3, 'Inbox', '$Work-Items']
    ])
  })

  test('uses special label prefixes and moves messages when a destination is available', async () => {
    state.selections.push(
      [filter('label', condition('from', 'contains', 'ada'), '$custom')],
      [message()],
      [{ id: 1, uid: 1, mailbox: 'Inbox', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [filter('label', condition('from', 'contains', 'ada'), '\\Custom')],
      [message()],
      [{ id: 2, uid: 2, mailbox: 'Inbox', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    state.selections.push([filter('move', condition('from', 'contains', 'ada'))], [message()])
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [filter('move', condition('from', 'contains', 'ada'), 'Archive')],
      [message()],
      [
        { id: 3, uid: 3, mailbox: 'Inbox', flags: '[]' },
        { id: 4, uid: 4, mailbox: 'Archive', flags: '[]' }
      ]
    )
    await filters.runFiltersOnMessages(['one'])
    assert.deepEqual(state.flags, [
      [1, 'Inbox', '$custom'],
      [2, 'Inbox', '\\Custom']
    ])
    assert.deepEqual(state.moves, [[3, 'Inbox', 'Archive']])
    assert.deepEqual(state.refreshes, [['Inbox', new Set(['thread'])]])
  })

  test('moves trash and delete matches only when a trash mailbox exists', async () => {
    state.selections.push(
      [filter('trash')],
      [message()],
      [{ id: 1, uid: 1, mailbox: 'Inbox', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    state.mailboxes.push({ name: 'Deleted Items', path: 'Trash' })
    state.selections.push(
      [filter('trash')],
      [message()],
      [{ id: 2, uid: 2, mailbox: 'Inbox', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    state.selections.push(
      [filter('delete')],
      [message()],
      [{ id: 3, uid: 3, mailbox: 'Trash', flags: '[]' }]
    )
    await filters.runFiltersOnMessages(['one'])
    assert.deepEqual(state.moves, [[2, 'Inbox', 'Trash']])
  })
})
