import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImapConfig } from './config'

type ClientPlan = {
  connect?: () => Promise<void>
  mailboxOpen?: () => Promise<void>
  logout?: () => Promise<void>
  closeThrows?: boolean
  usable?: boolean
}

type MockClient = {
  options: Record<string, unknown>
  connect: ReturnType<typeof vi.fn>
  mailboxOpen: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: (event: string, value?: unknown) => void
  usable: boolean
}

const state = vi.hoisted(() => ({
  clients: [] as MockClient[],
  plans: [] as ClientPlan[]
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: Record<string, unknown>) {
      const plan = state.plans.shift() ?? {}
      const listeners = new Map<string, Array<(value?: unknown) => void>>()
      const client: MockClient = {
        options,
        connect: vi.fn(plan.connect ?? (async () => undefined)),
        mailboxOpen: vi.fn(plan.mailboxOpen ?? (async () => undefined)),
        logout: vi.fn(plan.logout ?? (async () => undefined)),
        close: vi.fn(() => {
          if (plan.closeThrows) throw new Error('already closed')
        }),
        on: vi.fn((event: string, listener: (value?: unknown) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener])
          return client
        }),
        emit(event, value) {
          for (const listener of listeners.get(event) ?? []) listener(value)
        },
        usable: plan.usable ?? true
      }
      state.clients.push(client)
      return client
    }
  }
}))

import {
  addDirtyMailbox,
  canReuseWorkerConnection,
  closeImapConnections,
  getWorkerConnection,
  invalidateWorkerConnection,
  MAX_CONNECTIONS_PER_ACCOUNT,
  reconnectDelayMs,
  syncWatchers,
  wakeMailboxSync
} from './imap-connections'

const config = (overrides: Partial<ImapConfig> = {}): ImapConfig => ({
  id: 'primary',
  name: 'Primary',
  host: 'imap.example.com',
  port: 993,
  secure: true,
  allowInvalidCertificate: false,
  user: 'user@example.com',
  password: 'password',
  mailbox: 'INBOX',
  pollSeconds: 15,
  ...overrides
})

beforeEach(async () => {
  await syncWatchers([], vi.fn())
  state.clients.length = 0
  state.plans.length = 0
  vi.restoreAllMocks()
})

afterEach(async () => {
  await closeImapConnections()
  vi.useRealTimers()
})

describe('connection helpers', () => {
  it('backs off reconnects, coalesces mailboxes, and detects reusable workers', () => {
    assert.equal(reconnectDelayMs(0), 1_000)
    assert.equal(reconnectDelayMs(3), 8_000)
    assert.equal(reconnectDelayMs(20), 256_000)
    const dirty = new Map<string, Set<string>>()
    addDirtyMailbox(dirty, 'primary', 'INBOX')
    addDirtyMailbox(dirty, 'primary', 'INBOX')
    addDirtyMailbox(dirty, 'primary', 'Archive')
    assert.deepEqual([...dirty.get('primary')!], ['INBOX', 'Archive'])
    assert.equal(MAX_CONNECTIONS_PER_ACCOUNT, 2)
    assert.equal(canReuseWorkerConnection({ usable: true }), true)
    assert.equal(canReuseWorkerConnection({ usable: false }), false)
    assert.equal(canReuseWorkerConnection(null), false)
  })
})

describe('worker connections', () => {
  it('creates, reuses, invalidates, and replaces workers when settings change', async () => {
    const first = await getWorkerConnection(config())
    assert.deepEqual(state.clients[0].options, {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      tls: { rejectUnauthorized: true },
      auth: { user: 'user@example.com', pass: 'password' },
      logger: false,
      connectionTimeout: 20_000,
      qresync: true,
      maxIdleTime: undefined,
      missingIdleCommand: undefined
    })
    assert.equal(await getWorkerConnection(config()), first)
    assert.equal(state.clients.length, 1)

    invalidateWorkerConnection('other', first)
    assert.equal(state.clients[0].close.mock.calls.length, 0)
    invalidateWorkerConnection('primary', first)
    assert.equal(state.clients[0].close.mock.calls.length, 1)
    const second = await getWorkerConnection(config({ allowInvalidCertificate: true }))
    assert.notEqual(second, first)
    assert.deepEqual(state.clients[1].options.tls, { rejectUnauthorized: false })

    state.clients[1].usable = false
    await getWorkerConnection(config({ allowInvalidCertificate: true }))
    assert.equal(state.clients[1].close.mock.calls.length, 1)
    assert.equal(state.clients.length, 3)
  })

  it('coalesces connection attempts and rejects entries retired during connection', async () => {
    let finishConnect!: () => void
    state.plans.push({
      connect: () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve
        })
    })
    const pending = getWorkerConnection(config())
    const alsoPending = getWorkerConnection(config())
    assert.equal(state.clients.length, 1)
    const closing = closeImapConnections()
    finishConnect()
    await assert.rejects(pending, /retired/)
    await assert.rejects(alsoPending, /retired/)
    await closing
    assert.equal(state.clients[0].close.mock.calls.length, 2)
  })

  it('closes failed workers and applies a provider rate-limit cooldown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = Object.assign(new Error('connection refused'), {
      responseText: '[ALERT] Too many simultaneous connections'
    })
    state.plans.push({
      connect: async () => {
        throw error
      }
    })
    await assert.rejects(getWorkerConnection(config()), /connection refused/)
    assert.equal(state.clients[0].close.mock.calls.length, 1)
    await assert.rejects(getWorkerConnection(config()), /cooldown active until/)
    assert.equal(warn.mock.calls.length, 1)
  })

  it('recognizes rate-limit errors from messages and formats a fallback cooldown time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation((_, options) => {
      if (options) throw new RangeError('invalid timezone')
      return 'fallback time'
    })
    state.plans.push({
      connect: async () => {
        throw new Error('Too many simultaneous connections')
      }
    })
    await assert.rejects(getWorkerConnection(config()), /Too many simultaneous connections/)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback time'))
  })

  it('recognizes response rate limits and refuses new connections after shutdown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    state.plans.push({
      connect: async () => {
        throw { responseText: 'Too many simultaneous connections' }
      }
    })
    await assert.rejects(getWorkerConnection(config()))
    expect(warn).toHaveBeenCalledOnce()

    await closeImapConnections()
    await assert.rejects(getWorkerConnection(config({ id: 'stopped' })), /retired/)
    assert.equal(state.clients[1].close.mock.calls.length, 2)
  })
})

describe('watcher connections', () => {
  it('opens watchers, forwards mailbox changes, and reconnects after close', async () => {
    vi.useFakeTimers()
    const wake = vi.fn()
    await syncWatchers([config()], wake)
    const watcher = state.clients[0]
    assert.deepEqual(watcher.options, {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      tls: { rejectUnauthorized: true },
      auth: { user: 'user@example.com', pass: 'password' },
      logger: false,
      connectionTimeout: 20_000,
      qresync: true,
      maxIdleTime: 1_500_000,
      missingIdleCommand: 'NOOP'
    })
    expect(watcher.mailboxOpen).toHaveBeenCalledWith('INBOX')
    watcher.emit('exists')
    watcher.emit('expunge')
    watcher.emit('flags')
    expect(wake).toHaveBeenCalledTimes(3)
    wakeMailboxSync('manual', 'Sent')
    expect(wake).toHaveBeenLastCalledWith('manual', 'Sent')

    watcher.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    assert.equal(state.clients.length, 2)
    await syncWatchers([config()], wake)
    assert.equal(state.clients.length, 2)
  })

  it('does not reconnect scheduled watchers after shutdown', async () => {
    vi.useFakeTimers()
    await syncWatchers([config()], vi.fn())
    state.clients[0].emit('close')
    await closeImapConnections()
    await vi.advanceTimersByTimeAsync(1_000)
    assert.equal(state.clients.length, 1)
  })

  it('retires stale watchers and clears their pending reconnects', async () => {
    vi.useFakeTimers()
    await syncWatchers([config()], vi.fn())
    const staleWatcher = state.clients[0]
    staleWatcher.emit('close')
    await syncWatchers([config({ host: 'replacement.example.com' })], vi.fn())
    const replacementWatcher = state.clients[1]
    staleWatcher.emit('close')
    replacementWatcher.emit('close')
    await syncWatchers([], vi.fn())
    await closeImapConnections()
    replacementWatcher.emit('close')
    assert.equal(state.clients.length, 2)
  })

  it('logs watcher failures and errors, then retires removed entries', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    state.plans.push({
      connect: async () => {
        state.clients.at(-1)!.emit('close')
        throw new Error('offline')
      },
      closeThrows: true
    })
    await syncWatchers([config()], vi.fn())
    expect(log).toHaveBeenCalledWith('[imap] Primary watcher connect failed', expect.any(Error))
    assert.equal(state.clients[0].close.mock.calls.length, 1)
    await vi.advanceTimersByTimeAsync(1_000)
    const watcher = state.clients[1]
    watcher.emit('error', new Error('socket error'))
    expect(log).toHaveBeenCalledWith('[imap] Primary watcher error', expect.any(Error))

    const worker = await getWorkerConnection(config())
    await syncWatchers([], vi.fn())
    assert.equal(watcher.close.mock.calls.length, 1)
    assert.equal((worker as unknown as MockClient).close.mock.calls.length, 1)
  })

  it('clears a watcher that fails before it receives a close event', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    state.plans.push({
      connect: async () => {
        throw new Error('offline')
      }
    })
    await syncWatchers([config()], vi.fn())
    assert.equal(state.clients[0].close.mock.calls.length, 1)
  })
})

describe('shutdown', () => {
  it('logs out clients and closes clients whose logout fails', async () => {
    await syncWatchers([config()], vi.fn())
    const worker = await getWorkerConnection(config())
    state.clients[1].logout.mockRejectedValueOnce(new Error('logout failed'))
    await closeImapConnections()
    expect(state.clients[0].logout).toHaveBeenCalledOnce()
    expect((worker as unknown as MockClient).logout).toHaveBeenCalledOnce()
    expect((worker as unknown as MockClient).close).toHaveBeenCalledOnce()
    wakeMailboxSync('primary', 'INBOX')
  })
})
