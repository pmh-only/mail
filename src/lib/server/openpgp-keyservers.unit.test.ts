import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import type { PublicKey } from 'openpgp'

const state = vi.hoisted(() => ({ readKeys: vi.fn() }))
vi.mock('openpgp', () => ({ readKeys: state.readKeys }))
const keyservers = await import('./openpgp-keyservers.ts')

const key = (fingerprint: string, userIds = ['Alice <alice@example.com>'], options = {}) =>
  ({
    isPrivate: () => false,
    getUserIDs: () => userIds,
    getFingerprint: () => fingerprint,
    getEncryptionKey: async () => key,
    ...options
  }) as unknown as PublicKey
const response = (body: string, init?: ResponseInit) => new Response(body, init)

beforeEach(() => {
  state.readKeys.mockReset()
})

test('extracts bracketed and bare addresses while rejecting invalid user IDs', () => {
  assert.deepEqual(
    keyservers.openPgpKeyEmails(
      key('x', ['Name <A@Example.com>', ' bare@example.com ', 'not an address'])
    ),
    ['a@example.com', 'bare@example.com']
  )
})

test('rejects invalid addresses and handles provider response variants', async () => {
  assert.deepEqual(await keyservers.lookupOpenPgpKeysByEmail('invalid'), [])
  state.readKeys.mockResolvedValue([])
  let index = 0
  const fetch = async () => [response('', { status: 404 }), response('no blocks')][index++]!
  assert.deepEqual(
    await keyservers.lookupOpenPgpKeysByEmail('alice@example.com', { fetch, cache: false }),
    []
  )
  const noBody = { ok: true, status: 200, headers: new Headers(), body: null } as Response
  assert.deepEqual(
    await keyservers.lookupOpenPgpKeysByEmail('bob@example.com', {
      fetch: async () => noBody,
      cache: false
    }),
    []
  )
})

test('filters unusable keys, supports multiple keys, and catches parser failures', async () => {
  const privateKey = key('private', ['Alice <alice@example.com>'], { isPrivate: () => true })
  const wrongKey = key('wrong', ['Other <other@example.com>'])
  const failingKey = key('failing', ['Alice <alice@example.com>'], {
    getEncryptionKey: async () => {
      throw new Error('no encryption')
    }
  })
  state.readKeys.mockImplementation(async () => [
    privateKey,
    wrongKey,
    failingKey,
    key('one'),
    key('two')
  ])
  const data = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nx\n-----END PGP PUBLIC KEY BLOCK-----'
  assert.deepEqual(
    await keyservers.lookupOpenPgpKeysByEmail('alice@example.com', {
      fetch: async () => response(data),
      requireEncryption: true,
      cache: false
    }),
    []
  )
  state.readKeys.mockResolvedValue([key('one'), key('two')])
  assert.equal(
    (
      await keyservers.lookupOpenPgpKeysByEmail('alice@example.com', {
        fetch: async () => response(data),
        allowMultiple: true,
        cache: false
      })
    ).length,
    2
  )
  state.readKeys.mockRejectedValue(new Error('bad key'))
  assert.deepEqual(
    await keyservers.lookupOpenPgpKeysByEmail('alice@example.com', {
      fetch: async () => response(data),
      cache: false
    }),
    []
  )
})

test('limits streamed responses and uses cache and the provider circuit breaker', async () => {
  const large = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2_000_001))
      controller.close()
    }
  })
  assert.deepEqual(
    await keyservers.lookupOpenPgpKeysByEmail('large@example.com', {
      fetch: async () => new Response(large),
      cache: false
    }),
    []
  )
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return response('', { status: 500 })
  }
  try {
    await keyservers.lookupOpenPgpKeysByEmail('circuit@example.com')
    await keyservers.lookupOpenPgpKeysByEmail('other@example.com', { cache: false })
    assert.equal(requests, 2)
    globalThis.fetch = async () => {
      requests += 1
      return response('no keys')
    }
    vi.setSystemTime(Date.now() + 60_001)
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        keyservers.lookupOpenPgpKeysByEmail(`cache-${index}@example.com`)
      )
    )
    assert.ok(requests > 200)
    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    await keyservers.lookupOpenPgpKeysByEmail('offline@example.com', { cache: false })
  } finally {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  }
})

test('returns no keys when retrieving the global fetch implementation fails', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    get: () => {
      throw new Error('missing')
    }
  })
  try {
    assert.deepEqual(await keyservers.lookupOpenPgpKeysByEmail('getter@example.com'), [])
  } finally {
    Object.defineProperty(globalThis, 'fetch', descriptor!)
  }
})
