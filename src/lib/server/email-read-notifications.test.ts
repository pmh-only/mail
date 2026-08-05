import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const results: unknown[][] = []
  const table = (name: string) => new Proxy({}, { get: (_, key) => `${name}.${String(key)}` })
  const chain = (result: unknown[] = results.shift() ?? []) => {
    const value = Promise.resolve(result) as Promise<unknown[]> & Record<string, unknown>
    for (const name of ['from', 'where', 'limit', 'set']) value[name] = () => value
    value.returning = async () => result
    return value
  }
  return {
    results,
    db: {
      select: vi.fn(() => chain()),
      update: vi.fn(() => chain())
    },
    smtpJob: table('smtpJob'),
    mailMessageMailbox: table('mailMessageMailbox'),
    pathToSlug: vi.fn((path: string) => path.toLowerCase()),
    emailReadNotification: vi.fn((payload, url, id) => ({ payload, url, id })),
    emailReadNotificationRetryDelay: vi.fn((_attempt: number) => 1000),
    sendPushToAll: vi.fn(),
    logServerError: vi.fn()
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  smtpJob: state.smtpJob,
  mailMessageMailbox: state.mailMessageMailbox
}))
vi.mock('../mailbox', () => ({ pathToSlug: state.pathToSlug }))
vi.mock('./email-tracking', () => ({
  emailReadNotification: state.emailReadNotification,
  emailReadNotificationRetryDelay: state.emailReadNotificationRetryDelay
}))
vi.mock('./push', () => ({ sendPushToAll: state.sendPushToAll }))
vi.mock('./perf', () => ({ logServerError: state.logServerError }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  sql: vi.fn()
}))

const notifications = await import('./email-read-notifications.ts')

beforeEach(() => {
  state.results.length = 0
  vi.clearAllMocks()
  state.sendPushToAll.mockResolvedValue(true)
})

test('does nothing when the conditional claim is unavailable', async () => {
  state.results.push([])
  assert.equal(await notifications.dispatchEmailReadNotification(1), false)
  assert.equal(state.sendPushToAll.mock.calls.length, 0)
})

test('sends a claimed notification to its stored sent-mail copy and completes it', async () => {
  state.results.push(
    [{ id: 3, payload: 'tracked', messageId: '<id>', sentMailbox: 'Sent', attemptCount: 0 }],
    [{ id: 12 }],
    [{ id: 3 }]
  )
  assert.equal(await notifications.dispatchEmailReadNotification(3), true)
  assert.deepEqual(state.emailReadNotification.mock.calls[0], ['tracked', '/sent/12', 3])
  assert.equal(state.db.update.mock.calls.length, 2)
})

test('uses the job fallback URL and reschedules an undelivered notification', async () => {
  state.results.push(
    [{ id: 4, payload: 'tracked', messageId: null, sentMailbox: 'Sent', attemptCount: 2 }],
    [{ id: 4 }]
  )
  state.sendPushToAll.mockResolvedValue(false)
  assert.equal(await notifications.dispatchEmailReadNotification(4), false)
  assert.deepEqual(state.emailReadNotification.mock.calls[0], ['tracked', '/sent/-4', 4])
  assert.equal(state.emailReadNotificationRetryDelay.mock.calls[0][0], 3)
})

test('uses an empty mailbox comparison when a stored message has no sent mailbox', async () => {
  state.results.push(
    [{ id: 9, payload: 'tracked', messageId: '<id>', sentMailbox: undefined, attemptCount: 0 }],
    [],
    [{ id: 9 }]
  )

  assert.equal(await notifications.dispatchEmailReadNotification(9), true)
  assert.deepEqual(state.emailReadNotification.mock.calls[0], ['tracked', '/', 9])
})

test('uses the root URL without a sent mailbox and logs only successfully rescheduled failures', async () => {
  const failure = new Error('push failed')
  state.results.push(
    [{ id: 5, payload: 'tracked', messageId: null, sentMailbox: null, attemptCount: 1 }],
    [{ id: 5 }]
  )
  state.sendPushToAll.mockRejectedValueOnce(failure)
  assert.equal(await notifications.dispatchEmailReadNotification(5), false)
  assert.deepEqual(state.emailReadNotification.mock.calls[0], ['tracked', '/', 5])
  assert.deepEqual(state.logServerError.mock.calls[0], [
    'emailTracking.notify',
    failure,
    { jobId: 5, attemptCount: 2 }
  ])

  state.results.push(
    [{ id: 6, payload: 'tracked', messageId: null, sentMailbox: null, attemptCount: 0 }],
    []
  )
  state.sendPushToAll.mockRejectedValueOnce(failure)
  await notifications.dispatchEmailReadNotification(6)
  assert.equal(state.logServerError.mock.calls.length, 1)
})

test('dispatches every pending job and returns its count', async () => {
  state.results.push([{ id: 7 }, { id: 8 }], [], [])
  assert.equal(await notifications.dispatchPendingEmailReadNotifications(), 2)
  assert.equal(state.db.update.mock.calls.length, 2)
})
