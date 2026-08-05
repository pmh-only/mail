import assert from 'node:assert/strict'
import { test } from 'vitest'
import { generateKey, readKey } from 'openpgp'
import { lookupOpenPgpKeysByEmail, openPgpKeyEmails } from './openpgp-keyservers.ts'

test('retrieves and deduplicates an exact-address public key from both keyservers', async () => {
  const address = 'alice+lookup@example.com'
  const generated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Alice', email: address }],
    format: 'armored'
  })
  const requests: string[] = []
  const fetchMock = async (input: string | URL | Request) => {
    requests.push(String(input))
    return new Response(generated.publicKey, {
      headers: { 'content-type': 'application/pgp-keys' }
    })
  }

  const keys = await lookupOpenPgpKeysByEmail(address, { fetch: fetchMock, cache: false })

  assert.equal(keys.length, 1)
  assert.deepEqual(openPgpKeyEmails(keys[0]!), [address])
  assert.deepEqual(requests, [
    'https://keys.openpgp.org/vks/v1/by-email/alice%2Blookup%40example.com',
    'https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&exact=on&search=alice%2Blookup%40example.com'
  ])
})

test('ignores failures, oversized responses, malformed keys, and keys for another address', async () => {
  const generated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Mallory', email: 'mallory@example.com' }],
    format: 'armored'
  })
  let responseIndex = 0
  const responses = [
    new Response(generated.publicKey),
    new Response('not a key'),
    new Response(generated.publicKey, { headers: { 'content-length': '2000001' } }),
    new Response(null, { status: 404 })
  ]
  const fetchMock = async () => responses[responseIndex++]!

  assert.deepEqual(
    await lookupOpenPgpKeysByEmail('alice@example.com', { fetch: fetchMock, cache: false }),
    []
  )
  assert.deepEqual(
    await lookupOpenPgpKeysByEmail('bob@example.com', { fetch: fetchMock, cache: false }),
    []
  )
})

test('accepts bare-address user IDs and requires an encryption-capable key when requested', async () => {
  const address = 'bare@example.com'
  const generated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: address }],
    subkeys: [{ sign: true }],
    format: 'armored'
  })
  const fetchMock = async () => new Response(generated.publicKey)

  const verificationKeys = await lookupOpenPgpKeysByEmail(address, {
    fetch: fetchMock,
    cache: false
  })
  const encryptionKeys = await lookupOpenPgpKeysByEmail(address, {
    fetch: fetchMock,
    requireEncryption: true,
    cache: false
  })

  assert.equal(verificationKeys.length, 1)
  assert.deepEqual(openPgpKeyEmails(verificationKeys[0]!), [address])
  assert.equal(encryptionKeys.length, 0)
})

test('coalesces concurrent lookups and caches successful results', async () => {
  const address = 'cached@example.com'
  const generated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Cached', email: address }],
    format: 'armored'
  })
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    return new Response(generated.publicKey)
  }

  try {
    const [first, second] = await Promise.all([
      lookupOpenPgpKeysByEmail(address),
      lookupOpenPgpKeysByEmail(address)
    ])
    const cached = await lookupOpenPgpKeysByEmail(address)

    assert.equal(first.length, 1)
    assert.equal(second.length, 1)
    assert.equal(cached.length, 1)
    assert.equal(requestCount, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('prefers keys.openpgp.org and rejects ambiguous provider results for encryption', async () => {
  const address = 'conflict@example.com'
  const preferred = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Preferred', email: address }],
    format: 'armored'
  })
  const fallback = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Fallback', email: address }],
    format: 'armored'
  })
  let requestIndex = 0
  const fetchWithPreferred = async () =>
    new Response(requestIndex++ === 0 ? preferred.publicKey : fallback.publicKey)

  const selected = await lookupOpenPgpKeysByEmail(address, {
    fetch: fetchWithPreferred,
    requireEncryption: true,
    cache: false
  })
  assert.equal(selected.length, 1)
  assert.equal(
    selected[0]!.getFingerprint(),
    (await readKey({ armoredKey: preferred.publicKey })).getFingerprint()
  )

  requestIndex = 0
  const verificationKeys = await lookupOpenPgpKeysByEmail(address, {
    fetch: fetchWithPreferred,
    allowMultiple: true,
    cache: false
  })
  assert.equal(verificationKeys.length, 2)

  requestIndex = 0
  const fetchAmbiguousFallback = async () => {
    requestIndex += 1
    return requestIndex === 1
      ? new Response(null, { status: 404 })
      : new Response(`${preferred.publicKey}\n${fallback.publicKey}`)
  }
  const ambiguous = await lookupOpenPgpKeysByEmail(address, {
    fetch: fetchAmbiguousFallback,
    requireEncryption: true,
    cache: false
  })
  assert.deepEqual(ambiguous, [])
})
