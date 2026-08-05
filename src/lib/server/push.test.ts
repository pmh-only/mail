import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const selections: unknown[][] = []
  const chain = (rows: unknown[] = selections.shift() ?? []) => {
    const value = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
    for (const name of ['from', 'where', 'limit']) value[name] = () => value
    return value
  }
  return {
    selections,
    db: { select: vi.fn(() => chain()), delete: vi.fn(() => ({ where: vi.fn() })) },
    mailConfig: { id: 'config.id' },
    mailPushSubscription: { endpoint: 'sub.endpoint' },
    setVapidDetails: vi.fn(),
    getQuietHoursConfig: vi.fn(),
    isQuietHoursActive: vi.fn(),
    readControlSubscriptions: vi.fn((rows) => rows),
    readNotificationBatches: vi.fn((ids) => [ids]),
    pushDeliveryComplete: vi.fn((results) =>
      results.every((result: string) => result === 'delivered')
    ),
    validatePushSubscription: vi.fn((subscription) => subscription),
    sendWebPushSafely: vi.fn(),
    logServerError: vi.fn()
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  mailConfig: state.mailConfig,
  mailPushSubscription: state.mailPushSubscription
}))
vi.mock('web-push', () => ({ default: { setVapidDetails: state.setVapidDetails } }))
vi.mock('./config', () => ({ getQuietHoursConfig: state.getQuietHoursConfig }))
vi.mock('./quiet-hours', () => ({ isQuietHoursActive: state.isQuietHoursActive }))
vi.mock('$lib/push-control', () => ({
  readControlSubscriptions: state.readControlSubscriptions,
  readNotificationBatches: state.readNotificationBatches
}))
vi.mock('$lib/push-delivery', () => ({ pushDeliveryComplete: state.pushDeliveryComplete }))
vi.mock('./push-endpoint', () => ({
  validatePushSubscription: state.validatePushSubscription,
  sendWebPushSafely: state.sendWebPushSafely
}))
vi.mock('./perf', () => ({ logServerError: state.logServerError }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

const push = await import('./push.ts')
const config = {
  vapidPublicKey: 'public',
  vapidPrivateKey: 'private',
  vapidSubject: 'mailto:a@example.test'
}
const subscription = { endpoint: 'https://push.example.test/a', p256dh: 'key', auth: 'auth' }

beforeEach(() => {
  state.selections.length = 0
  vi.clearAllMocks()
  push.resetPushInit()
  state.isQuietHoursActive.mockReturnValue(false)
  state.sendWebPushSafely.mockResolvedValue(undefined)
})

test('returns the configured public key and refuses delivery without complete VAPID details', async () => {
  state.selections.push([{ vapidPublicKey: 'public' }], [], [{}])
  assert.equal(await push.getVapidPublicKey(), 'public')
  assert.equal(await push.getVapidPublicKey(), null)
  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world' }), false)
  assert.equal(state.setVapidDetails.mock.calls.length, 0)
})

test('returns null for a configuration row without a VAPID public key', async () => {
  state.selections.push([{}])

  assert.equal(await push.getVapidPublicKey(), null)
})

test('skips new-mail delivery during quiet hours and when no subscriptions exist', async () => {
  state.isQuietHoursActive.mockReturnValueOnce(true)
  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world' }), false)
  state.selections.push([config], [])
  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world' }), false)
  assert.equal(state.setVapidDetails.mock.calls.length, 1)
})

test('delivers validated subscriptions and removes expired endpoints', async () => {
  state.selections.push(
    [config],
    [subscription, { ...subscription, endpoint: 'https://push.example.test/gone' }]
  )
  state.sendWebPushSafely
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce({ statusCode: 410 })
  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world', unreadCount: 2 }), false)
  assert.equal(state.sendWebPushSafely.mock.calls.length, 2)
  assert.equal(state.db.delete.mock.calls.length, 1)
})

test('logs final failures and retries retryable control notifications', async () => {
  vi.useFakeTimers()
  state.selections.push([config], [subscription])
  state.sendWebPushSafely
    .mockRejectedValueOnce({ statusCode: 500 })
    .mockResolvedValueOnce(undefined)
  const dismissed = push.dismissReadNotifications([1, 2])
  await vi.advanceTimersByTimeAsync(250)
  await dismissed
  assert.equal(state.readControlSubscriptions.mock.calls.length, 1)
  assert.equal(state.sendWebPushSafely.mock.calls.length, 2)

  state.selections.push([subscription])
  state.sendWebPushSafely.mockRejectedValueOnce({ statusCode: 400 })
  await push.sendPushToAll({ title: 'hello', body: 'world' })
  assert.deepEqual(state.logServerError.mock.calls[0][2], {
    endpointOrigin: 'https://push.example.test',
    status: 400,
    attempts: 1
  })
  vi.useRealTimers()
})

test('logs retryable delivery failures without a status code', async () => {
  state.selections.push([config], [subscription])
  state.sendWebPushSafely.mockRejectedValueOnce(new Error('network failed'))

  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world' }), false)
  assert.deepEqual(state.logServerError.mock.calls[0][2], {
    endpointOrigin: 'https://push.example.test',
    status: null,
    attempts: 1
  })
})

test('reports completed delivery when every subscription succeeds', async () => {
  state.selections.push([config], [subscription])

  assert.equal(await push.sendPushToAll({ title: 'hello', body: 'world' }), true)
  assert.equal(state.sendWebPushSafely.mock.calls.length, 1)
})
