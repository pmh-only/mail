import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  class MockAgent {
    lookup: unknown
    destroy = vi.fn()

    constructor(options: { lookup: unknown }) {
      this.lookup = options.lookup
    }
  }

  return {
    Agent: MockAgent,
    agents: [] as MockAgent[],
    lookup: vi.fn(),
    request: vi.fn(),
    generateRequestDetails: vi.fn()
  }
})

vi.mock('node:dns/promises', () => ({ lookup: state.lookup }))
vi.mock('node:https', () => ({
  Agent: class extends state.Agent {
    constructor(options: { lookup: unknown }) {
      super(options)
      state.agents.push(this)
    }
  },
  request: state.request
}))
vi.mock('web-push', () => ({ default: { generateRequestDetails: state.generateRequestDetails } }))

import { isPublicIpAddress, sendWebPushSafely, validatePushSubscription } from './push-endpoint.ts'

const valid = {
  endpoint: 'https://push.example.test/subscription',
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'),
    auth: Buffer.alloc(16).toString('base64url')
  }
}

function request() {
  const result = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  result.destroy = vi.fn((error?: Error) => result.emit('error', error))
  result.end = vi.fn()
  return result
}

function response(statusCode = 201) {
  const result = new EventEmitter() as EventEmitter & {
    statusCode?: number
    destroy: ReturnType<typeof vi.fn>
  }
  result.statusCode = statusCode
  result.destroy = vi.fn((error?: Error) => result.emit('error', error))
  return result
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  state.agents.length = 0
})

test('identifies public IPv4 and IPv6 addresses while rejecting private and reserved ranges', () => {
  for (const address of [
    'not-an-ip',
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1'
  ]) {
    assert.equal(isPublicIpAddress(address), false, address)
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true)
  assert.equal(isPublicIpAddress('::ffff:8.8.8.8'), true)
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true)
})

test('validates, canonicalizes, and rejects malformed push subscriptions', () => {
  assert.deepEqual(
    validatePushSubscription({ ...valid, endpoint: 'https://PUSH.example.test/a/../subscription' }),
    valid
  )

  for (const value of [
    null,
    'subscription',
    {},
    { endpoint: 1 },
    { endpoint: 'x'.repeat(2049) },
    { endpoint: 'not a URL' }
  ]) {
    assert.throws(
      () => validatePushSubscription(value),
      /Invalid subscription|Invalid push endpoint/
    )
  }
  for (const endpoint of [
    'http://example.test',
    'https://user@example.test',
    'https://example.test/#fragment',
    'https://localhost/x',
    'https://sub.localhost/x',
    'https://server.local/x',
    'https://server.home.arpa/x',
    'https://127.0.0.1/x',
    'https://[::1]/x'
  ]) {
    assert.throws(() => validatePushSubscription({ ...valid, endpoint }), /Unsafe push endpoint/)
  }
  for (const keys of [
    undefined,
    {},
    { p256dh: '', auth: valid.keys.auth },
    { p256dh: '!', auth: valid.keys.auth },
    { p256dh: Buffer.alloc(65).toString('base64url'), auth: valid.keys.auth },
    { p256dh: valid.keys.p256dh, auth: Buffer.alloc(15).toString('base64url') }
  ]) {
    assert.throws(
      () => validatePushSubscription({ ...valid, keys }),
      /Invalid push encryption keys/
    )
  }
  assert.throws(
    () => validatePushSubscription({ ...valid, keys: { p256dh: '=', auth: valid.keys.auth } }),
    /Invalid push encryption keys/
  )
})

test('pins a public DNS result and resolves successful push responses', async () => {
  const outgoing = request()
  state.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  state.request.mockReturnValue(outgoing)
  state.generateRequestDetails.mockReturnValue({
    endpoint: valid.endpoint,
    method: 'POST',
    headers: { ttl: '60' },
    body: 'encrypted'
  })

  const sent = sendWebPushSafely(valid, 'payload', 60)
  await vi.waitFor(() => assert.equal(state.request.mock.calls.length, 1))
  const options = state.request.mock.calls[0][1]
  assert.equal(options.method, 'POST')
  assert.equal(options.agent, state.agents[0])
  await new Promise<void>((resolve, reject) =>
    options.agent.lookup('ignored', { all: true }, (error: Error | null, addresses: unknown) =>
      error
        ? reject(error)
        : (assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]), resolve())
    )
  )
  await new Promise<void>((resolve, reject) =>
    options.agent.lookup('ignored', 4, (error: Error | null, address: string, family: number) =>
      error ? reject(error) : (assert.equal(address, '8.8.8.8'), assert.equal(family, 4), resolve())
    )
  )
  const incoming = response()
  outgoing.emit('response', incoming)
  incoming.emit('data', Buffer.from('ok'))
  incoming.emit('end')
  await sent

  assert.deepEqual(state.lookup.mock.calls[0], ['push.example.test', { all: true, verbatim: true }])
  assert.deepEqual(state.generateRequestDetails.mock.calls[0], [valid, 'payload', { TTL: 60 }])
  assert.deepEqual(outgoing.end.mock.calls, [['encrypted']])
  assert.equal(state.agents[0].destroy.mock.calls.length, 1)
})

test('uses literal public IPs without DNS and rejects unsafe DNS answers', async () => {
  const outgoing = request()
  state.request.mockReturnValue(outgoing)
  state.generateRequestDetails.mockReturnValue({
    endpoint: 'https://8.8.8.8/',
    method: 'POST',
    headers: {},
    body: ''
  })
  const sending = sendWebPushSafely({ ...valid, endpoint: 'https://8.8.8.8/' }, '', 0)
  await vi.waitFor(() => assert.equal(state.request.mock.calls.length, 1))
  const incoming = response(204)
  outgoing.emit('response', incoming)
  incoming.emit('end')
  await sending
  assert.equal(state.lookup.mock.calls.length, 0)

  state.lookup.mockResolvedValue([])
  await assert.rejects(sendWebPushSafely(valid, '', 0), /private address/)
  state.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 }
  ])
  await assert.rejects(sendWebPushSafely(valid, '', 0), /private address/)
})

test('defends direct callers against private literal endpoints', async () => {
  await assert.rejects(
    sendWebPushSafely({ ...valid, endpoint: 'https://127.0.0.1/' }, '', 0),
    /private address/
  )
  assert.equal(state.lookup.mock.calls.length, 0)
})

test('rejects failed responses, request errors, response errors, oversized bodies, and timeouts', async () => {
  state.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  state.generateRequestDetails.mockReturnValue({
    endpoint: valid.endpoint,
    method: 'POST',
    headers: {},
    body: ''
  })

  for (const [index, trigger] of [
    (outgoing: ReturnType<typeof request>) => {
      const incoming = response(503)
      outgoing.emit('response', incoming)
      incoming.emit('end')
    },
    (outgoing: ReturnType<typeof request>) => outgoing.emit('error', new Error('request failed')),
    (outgoing: ReturnType<typeof request>) => {
      const incoming = response()
      outgoing.emit('response', incoming)
      incoming.emit('error', new Error('response failed'))
    },
    (outgoing: ReturnType<typeof request>) => {
      const incoming = response()
      outgoing.emit('response', incoming)
      incoming.emit('data', Buffer.alloc(64 * 1024 + 1))
    }
  ].entries()) {
    const outgoing = request()
    state.request.mockReturnValueOnce(outgoing)
    const sending = sendWebPushSafely(valid, '', 0)
    await vi.waitFor(() => assert.equal(state.request.mock.calls.length, index + 1))
    const rejected = assert.rejects(sending)
    trigger(outgoing)
    await rejected
  }

  vi.useFakeTimers()
  const outgoing = request()
  state.request.mockReturnValueOnce(outgoing)
  const timedOut = sendWebPushSafely(valid, '', 0)
  const rejected = assert.rejects(timedOut, /timed out/)
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  assert.equal(outgoing.destroy.mock.calls.length, 1)
})

test('treats a response without a status code as a failed push service request', async () => {
  state.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  state.generateRequestDetails.mockReturnValue({
    endpoint: valid.endpoint,
    method: 'POST',
    headers: {},
    body: ''
  })
  const outgoing = request()
  state.request.mockReturnValue(outgoing)

  const sending = sendWebPushSafely(valid, '', 0)
  await vi.waitFor(() => assert.equal(state.request.mock.calls.length, 1))
  const incoming = response()
  incoming.statusCode = undefined
  outgoing.emit('response', incoming)
  const rejected = assert.rejects(sending, /returned 500/)
  incoming.emit('end')
  await rejected
  assert.equal(state.agents[0].destroy.mock.calls.length, 1)
})
