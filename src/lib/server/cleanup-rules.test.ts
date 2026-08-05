import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const results: unknown[][] = []
  const operations: Array<{ name: string; value?: unknown }> = []
  const chain = (rows: unknown[] = results.shift() ?? []) => {
    const value = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
    for (const name of ['from', 'innerJoin', 'where', 'orderBy', 'set']) value[name] = () => value
    value.limit = async (limit: number) => {
      operations.push({ name: 'limit', value: limit })
      return rows
    }
    return value
  }
  return {
    results,
    operations,
    db: {
      select: vi.fn(() => chain()),
      delete: vi.fn(() => ({ where: vi.fn() })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }))
    },
    mailCleanupRule: new Proxy({}, { get: (_, key) => `rule.${String(key)}` }),
    mailMessage: new Proxy({}, { get: (_, key) => `message.${String(key)}` }),
    mailMessageMailbox: new Proxy({}, { get: (_, key) => `mailbox.${String(key)}` }),
    scheduleMoveMessage: vi.fn(),
    getImapMailboxes: vi.fn(),
    getMailboxRole: vi.fn(),
    refreshThreadSummaries: vi.fn()
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  mailCleanupRule: state.mailCleanupRule,
  mailMessage: state.mailMessage,
  mailMessageMailbox: state.mailMessageMailbox
}))
vi.mock('./imap-operations', () => ({ scheduleMoveMessage: state.scheduleMoveMessage }))
vi.mock('./mail', () => ({
  getImapMailboxes: state.getImapMailboxes,
  getMailboxRole: state.getMailboxRole,
  refreshThreadSummaries: state.refreshThreadSummaries
}))
vi.mock('drizzle-orm', () => ({ and: vi.fn(), desc: vi.fn(), eq: vi.fn(), lt: vi.fn() }))

const cleanup = await import('./cleanup-rules.ts')

beforeEach(() => {
  state.results.length = 0
  state.operations.length = 0
  vi.clearAllMocks()
  state.getMailboxRole.mockImplementation(
    (mailbox: string) => ({ Archive: 'archive', Trash: 'trash', Spam: 'spam' })[mailbox]
  )
  state.getImapMailboxes.mockResolvedValue([])
})

test('normalizes cleanup input and rejects unsafe ages', () => {
  assert.deepEqual(cleanup.normalizeCleanupRuleInput({ minAgeDays: 7, mailbox: ' Inbox ' }), {
    enabled: true,
    mailbox: 'Inbox',
    minAgeDays: 7,
    action: 'archive'
  })
  assert.deepEqual(
    cleanup.normalizeCleanupRuleInput({
      enabled: false,
      minAgeDays: '8' as never,
      mailbox: 1 as never
    }),
    { enabled: false, mailbox: null, minAgeDays: 8, action: 'archive' }
  )
  assert.throws(() => cleanup.normalizeCleanupRuleInput({ minAgeDays: 6 }), /at least 7/)
  assert.deepEqual(cleanup.normalizeCleanupRuleInput({ minAgeDays: 7, mailbox: '   ' }), {
    enabled: true,
    mailbox: null,
    minAgeDays: 7,
    action: 'archive'
  })
})

test('previews eligible messages while warning for excluded source mailboxes', async () => {
  state.results.push([
    { id: 1, messageId: 'a', subject: 'A', from: 'a@test', mailbox: 'Inbox', receivedAt: null },
    { id: 2, messageId: 'b', subject: 'B', from: 'b@test', mailbox: 'Archive', receivedAt: null },
    { id: 3, messageId: 'c', subject: 'C', from: 'c@test', mailbox: 'Spam', receivedAt: null }
  ])
  const preview = await cleanup.previewCleanupRule({ minAgeDays: 7, mailbox: 'Archive' }, 1)
  assert.match(preview.warning ?? '', /Archive/)
  assert.deepEqual(
    preview.matches.map((row) => row.id),
    [1]
  )
  assert.deepEqual(state.operations[0], { name: 'limit', value: 4 })
})

test('scopes previews to a mailbox and warns for spam source mailboxes', async () => {
  state.results.push([
    { id: 1, messageId: 'a', subject: 'A', from: 'a@test', mailbox: 'Inbox', receivedAt: null },
    { id: 2, messageId: 'b', subject: 'B', from: 'b@test', mailbox: 'Projects', receivedAt: null }
  ])

  const preview = await cleanup.previewCleanupRule({ minAgeDays: 7, mailbox: 'Spam' }, 2)

  assert.match(preview.warning ?? '', /Spam/)
  assert.deepEqual(
    preview.matches.map((row) => row.id),
    [1, 2]
  )
  assert.deepEqual(state.operations[0], { name: 'limit', value: 8 })
})

test('previews unscoped candidates and warns for trash source mailboxes', async () => {
  state.results.push([{ id: 1, messageId: 'a', subject: 'A', from: 'a@test', mailbox: 'Inbox' }])
  const unscoped = await cleanup.previewCleanupRule({ minAgeDays: 7 })
  assert.equal(unscoped.warning, null)
  assert.equal(unscoped.matches.length, 1)

  state.results.push([])
  const trash = await cleanup.previewCleanupRule({ minAgeDays: 7, mailbox: 'Trash' })
  assert.match(trash.warning ?? '', /Trash/)
})

test('does not warn when a scoped source mailbox is eligible for cleanup', async () => {
  state.results.push([])

  const preview = await cleanup.previewCleanupRule({ minAgeDays: 7, mailbox: 'Inbox' })

  assert.equal(preview.warning, null)
})

test('returns zero without rules or an archive destination', async () => {
  state.results.push([])
  assert.equal(await cleanup.runCleanupRules(), 0)
  state.results.push([{ id: 1, enabled: true, action: 'archive', mailbox: null, minAgeDays: 7 }])
  assert.equal(await cleanup.runCleanupRules(), 0)
})

test('archives eligible candidates, refreshes touched threads, and observes the rule limit', async () => {
  state.results.push(
    [{ id: 1, enabled: true, action: 'archive', mailbox: null, minAgeDays: 7 }],
    [
      { id: 1, messageId: 'one', mailbox: 'Inbox', uid: 10, threadKey: 'thread', receivedAt: null },
      { id: 2, messageId: 'two', mailbox: 'Trash', uid: 11, threadKey: null, receivedAt: null },
      { id: 3, messageId: 'three', mailbox: 'Inbox', uid: 12, threadKey: null, receivedAt: null }
    ]
  )
  state.getImapMailboxes.mockResolvedValue([{ name: 'Archive', path: 'Archive' }])
  assert.equal(await cleanup.runCleanupRules(1), 1)
  assert.deepEqual(state.scheduleMoveMessage.mock.calls[0], [10, 'Inbox', 'Archive'])
  assert.deepEqual(state.refreshThreadSummaries.mock.calls[0], ['Inbox', new Set(['thread'])])
})

test('finds archive mailboxes by name and skips candidates already in that mailbox', async () => {
  state.results.push(
    [{ id: 1, enabled: true, action: 'archive', mailbox: 'Inbox', minAgeDays: 7 }],
    [
      {
        id: 1,
        messageId: 'archived',
        mailbox: 'Archive/2026',
        uid: 10,
        threadKey: null,
        receivedAt: null
      },
      { id: 2, messageId: 'move', mailbox: 'Inbox', uid: 11, threadKey: null, receivedAt: null }
    ]
  )
  state.getImapMailboxes.mockResolvedValue([{ name: 'Archive', path: 'Archive/2026' }])

  assert.equal(await cleanup.runCleanupRules(), 1)
  assert.deepEqual(state.scheduleMoveMessage.mock.calls, [[11, 'Inbox', 'Archive/2026']])
})

test('skips spam candidates while continuing with later eligible messages', async () => {
  state.results.push(
    [{ id: 1, enabled: true, action: 'archive', mailbox: null, minAgeDays: 7 }],
    [
      { id: 1, messageId: 'spam', mailbox: 'Spam', uid: 10, threadKey: null, receivedAt: null },
      { id: 2, messageId: 'move', mailbox: 'Inbox', uid: 11, threadKey: null, receivedAt: null }
    ]
  )
  state.getImapMailboxes.mockResolvedValue([{ name: 'Archive', path: 'Archive' }])

  assert.equal(await cleanup.runCleanupRules(), 1)
  assert.deepEqual(state.scheduleMoveMessage.mock.calls, [[11, 'Inbox', 'Archive']])
})

test('runs the worker at most once per interval and clears its in-flight state', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  state.results.push([])
  assert.equal(await cleanup.maybeRunCleanupRulesFromWorker(), 0)
  assert.equal(await cleanup.maybeRunCleanupRulesFromWorker(), 0)
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
  state.results.push([])
  assert.equal(await cleanup.maybeRunCleanupRulesFromWorker(), 0)
  vi.useRealTimers()
})

test('does not start a second cleanup worker while the first run is in flight', async () => {
  let releaseRules: ((rows: unknown[]) => void) | undefined
  state.results.push(
    new Promise<unknown[]>((resolve) => {
      releaseRules = resolve
    }) as never
  )
  const first = cleanup.maybeRunCleanupRulesFromWorker()
  await Promise.resolve()

  assert.equal(await cleanup.maybeRunCleanupRulesFromWorker(), 0)
  releaseRules?.([])
  assert.equal(await first, 0)
})
