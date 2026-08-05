import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const results: Array<Array<{ enabled?: boolean; mailbox?: string }>> = []
  const values: unknown[] = []
  const conflicts: unknown[] = []
  const table = new Proxy({}, { get: (_, key) => `setting.${String(key)}` })
  const query = (rows = results.shift() ?? []) => {
    const value = Promise.resolve(rows) as Promise<typeof rows> & Record<string, unknown>
    value.from = () => value
    value.where = () => value
    value.limit = async () => rows
    return value
  }
  return {
    results,
    values,
    conflicts,
    alwaysRead: vi.fn((mailbox: string) => mailbox === 'Sent'),
    db: {
      select: vi.fn(() => query()),
      insert: vi.fn(() => {
        const chain = {
          values(value: unknown) {
            values.push(value)
            return chain
          },
          onConflictDoUpdate(value: unknown) {
            conflicts.push(value)
            return Promise.resolve()
          }
        }
        return chain
      })
    },
    table
  }
})

vi.mock('$lib/mailbox', () => ({ isAlwaysReadMailbox: state.alwaysRead }))
vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({ mailboxNotificationSetting: state.table }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

const notifications = await import('./mailbox-notifications.ts')

beforeEach(() => {
  state.results.length = 0
  state.values.length = 0
  state.conflicts.length = 0
  vi.clearAllMocks()
})

test('does not notify always-read mailboxes and defaults missing rules to enabled', async () => {
  assert.equal(await notifications.shouldSendMailboxNotifications('Sent'), false)
  assert.equal(state.db.select.mock.calls.length, 0)

  state.results.push([])
  assert.equal(await notifications.shouldSendMailboxNotifications('Inbox'), true)
  state.results.push([{ enabled: false }])
  assert.equal(await notifications.shouldSendMailboxNotifications('Archive'), false)
})

test('lists notification capabilities and persists mailbox rules', async () => {
  state.results.push([{ mailbox: 'Inbox', enabled: false }])
  assert.deepEqual(
    await notifications.getMailboxNotificationRules([{ path: 'Inbox' }, { path: 'Sent' }]),
    [
      { mailbox: 'Inbox', enabled: false, canNotify: true },
      { mailbox: 'Sent', enabled: true, canNotify: false }
    ]
  )

  await notifications.setMailboxNotificationRule('Inbox', false)
  assert.match(String((state.values[0] as { updatedAt: unknown }).updatedAt), /\d{4}/)
  assert.equal((state.conflicts[0] as { target: string }).target, 'setting.mailbox')
  assert.equal((state.conflicts[0] as { set: { enabled: boolean } }).set.enabled, false)
})
