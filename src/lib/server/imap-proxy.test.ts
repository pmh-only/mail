import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

class FakeSocket extends EventEmitter {
  destroyed = false
  readonly setTimeout = vi.fn()
  readonly pause = vi.fn()
  readonly resume = vi.fn()
  readonly pipe = vi.fn()
  readonly destroy = vi.fn(() => {
    this.destroyed = true
  })
}

const state = vi.hoisted(() => ({
  handler: undefined as ((socket: FakeSocket) => void) | undefined,
  server: { maxConnections: 0 },
  upstream: undefined as FakeSocket | undefined,
  createConnection: vi.fn(),
  createServer: vi.fn()
}))

vi.mock('node:net', () => ({
  createConnection: state.createConnection,
  createServer: state.createServer
}))

import { createImapProxyServer } from './imap-proxy.ts'

beforeEach(() => {
  state.handler = undefined
  state.server = { maxConnections: 0 }
  state.upstream = undefined
  state.createServer.mockReset().mockImplementation((handler: (socket: FakeSocket) => void) => {
    state.handler = handler
    return state.server
  })
  state.createConnection.mockReset().mockImplementation(() => state.upstream)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

test('connects resolved targets, pipes both directions, and manages active sockets', async () => {
  const client = new FakeSocket()
  const upstream = new FakeSocket()
  state.upstream = upstream
  const active = new Set<FakeSocket>()
  const server = createImapProxyServer(
    async () => ({ host: 'imap.example.com', port: 993 }),
    active as never,
    {
      maxConnections: 2,
      targetTimeoutMs: 5,
      connectTimeoutMs: 6,
      idleTimeoutMs: 7
    }
  )

  assert.equal(server.maxConnections, 2)
  state.handler!(client)
  await vi.waitFor(() =>
    assert.deepEqual(state.createConnection.mock.calls, [[{ host: 'imap.example.com', port: 993 }]])
  )
  assert.equal(active.has(client), true)
  assert.equal(active.has(upstream), true)
  assert.equal(client.setTimeout.mock.calls[0]?.[0], 7)
  assert.equal(typeof client.setTimeout.mock.calls[0]?.[1], 'function')
  assert.equal(upstream.setTimeout.mock.calls[0]?.[0], 6)
  assert.equal(typeof upstream.setTimeout.mock.calls[0]?.[1], 'function')

  const connectTimeoutHandler = upstream.setTimeout.mock.calls[0]?.[1] as () => void
  connectTimeoutHandler()
  assert.equal(upstream.destroy.mock.calls.length, 1)

  upstream.emit('connect')
  assert.equal(upstream.setTimeout.mock.calls[1]?.[0], 7)
  assert.equal(typeof upstream.setTimeout.mock.calls[1]?.[1], 'function')
  assert.deepEqual(client.pipe.mock.calls, [[upstream]])
  assert.deepEqual(upstream.pipe.mock.calls, [[client]])
  assert.equal(client.resume.mock.calls.length, 1)

  const idleTimeoutHandler = upstream.setTimeout.mock.calls[1]?.[1] as () => void
  idleTimeoutHandler()
  assert.equal(upstream.destroy.mock.calls.length, 2)

  client.emit('error', new Error('client'))
  assert.equal(upstream.destroy.mock.calls.length, 3)
  client.emit('close')
  upstream.emit('close')
  assert.equal(active.size, 0)
})

test('destroys idle sockets and reports target resolution failures', async () => {
  vi.useFakeTimers()
  const client = new FakeSocket()
  createImapProxyServer(
    async () => {
      throw new Error('lookup failed')
    },
    new Set() as never,
    { idleTimeoutMs: 3 }
  )
  state.handler!(client)
  await vi.runAllTimersAsync()
  assert.equal(client.destroy.mock.calls.length, 1)
  assert.match(String(vi.mocked(console.error).mock.calls[0]?.[1]), /lookup failed/)

  const idleHandler = client.setTimeout.mock.calls[0]?.[1] as () => void
  idleHandler()
  assert.equal(client.destroy.mock.calls.length, 2)
  vi.useRealTimers()
})

test('times out lookup, skips destroyed clients, and destroys clients on upstream errors', async () => {
  vi.useFakeTimers()
  const timedOutClient = new FakeSocket()
  createImapProxyServer(() => new Promise(() => undefined), new Set() as never, {
    targetTimeoutMs: 2
  })
  state.handler!(timedOutClient)
  await vi.advanceTimersByTimeAsync(2)
  assert.equal(timedOutClient.destroy.mock.calls.length, 1)

  const destroyedClient = new FakeSocket()
  destroyedClient.destroyed = true
  createImapProxyServer(async () => ({ host: 'host', port: 1 }))
  state.handler!(destroyedClient)
  await vi.runAllTimersAsync()
  assert.equal(state.createConnection.mock.calls.length, 0)

  const client = new FakeSocket()
  const upstream = new FakeSocket()
  state.upstream = upstream
  createImapProxyServer(async () => ({ host: 'host', port: 1 }))
  state.handler!(client)
  await vi.runAllTimersAsync()
  upstream.emit('error', new Error('refused'))
  assert.equal(client.destroy.mock.calls.length, 1)
  vi.useRealTimers()
})

test('cleans up a lookup timeout when target resolution throws synchronously', async () => {
  const client = new FakeSocket()
  createImapProxyServer((() => {
    throw new Error('bad target')
  }) as never)
  state.handler!(client)
  await vi.waitFor(() => assert.equal(client.destroy.mock.calls.length, 1))
})
