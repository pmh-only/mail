import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import type { PrivateKey } from 'openpgp'

const state = vi.hoisted(() => ({
  hashAlgorithm: 8,
  decryptResult: { data: 'plain', signatures: [] as unknown[] },
  verifyResult: { data: 'verified', signatures: [] as unknown[] },
  failDecrypt: null as unknown,
  failVerify: null as unknown,
  calls: [] as Array<{ name: string; value: unknown }>
}))

vi.mock('openpgp', () => ({
  createCleartextMessage: vi.fn(async (value) => ({ clear: value.text })),
  createMessage: vi.fn(async (value) => ({ message: value })),
  decrypt: vi.fn(async (value) => {
    state.calls.push({ name: 'decrypt', value })
    if (state.failDecrypt) throw state.failDecrypt
    return state.decryptResult
  }),
  encrypt: vi.fn(async (value) => {
    state.calls.push({ name: 'encrypt', value })
    return 'encrypted\n'
  }),
  readCleartextMessage: vi.fn(async (value) => value),
  readMessage: vi.fn(async (value) => value),
  readSignature: vi.fn(async (value) => ({
    ...value,
    packets: [{ hashAlgorithm: state.hashAlgorithm }]
  })),
  sign: vi.fn(async (value) => {
    state.calls.push({ name: 'sign', value })
    return 'signature\n'
  }),
  verify: vi.fn(async (value) => {
    state.calls.push({ name: 'verify', value })
    if (state.failVerify) throw state.failVerify
    return state.verifyResult
  })
}))

const message = await import('./openpgp-message.ts')

const key = (id = 'KEY', emails = ['Alice <alice@example.com>']) =>
  ({
    getKeyIDs: () => [{ toHex: () => id }],
    getUserIDs: () => emails,
    getFingerprint: () => `FINGERPRINT-${id}`
  }) as never
const signature = (id = 'KEY', verified: Promise<unknown> = Promise.resolve()) => ({
  keyID: { toHex: () => id },
  verified
})
const input = (overrides: Record<string, unknown> = {}) =>
  ({
    raw: Buffer.from('From: sender@example.com\nSubject: Test\n\nRaw body'),
    privateKeys: [],
    verificationKeys: [key()],
    ...overrides
  }) as Parameters<typeof message.processInboundOpenPgp>[0]

beforeEach(() => {
  state.hashAlgorithm = 8
  state.decryptResult = { data: 'plain', signatures: [] }
  state.verifyResult = { data: 'verified', signatures: [] }
  state.failDecrypt = null
  state.failVerify = null
  state.calls.length = 0
})

test('creates cleartext, detached, signed, and encrypted MIME messages', async () => {
  await message.clearSignText('clear', key())
  await message.detachedSignText('detached', key())
  for (const [algorithm, micalg] of [
    [8, 'pgp-sha256'],
    [9, 'pgp-sha384'],
    [10, 'pgp-sha512'],
    [11, 'pgp-sha224'],
    [2, 'pgp-sha1'],
    [0, 'pgp-unknown']
  ] as const) {
    state.hashAlgorithm = algorithm
    assert.match(
      (
        await message.signPgpMime(
          Buffer.from('From: A\r\nContent-Type: text/html\r\n folded\r\n\r\nBody'),
          key() as PrivateKey
        )
      ).toString(),
      new RegExp(`micalg=${micalg}`)
    )
  }
  const encrypted = await message.encryptPgpMime(Buffer.from('From: A\r\n\r\nBody'), [key()])
  assert.match(encrypted.toString(), /multipart\/encrypted/)
  assert.match(
    (
      await message.signPgpMime(Buffer.from('From: A\r\n folded\r\n\r\nBody'), key() as PrivateKey)
    ).toString(),
    /From: A\r\n folded/
  )
  assert.equal(state.calls.filter((call) => call.name === 'sign').length, 9)
})

test('returns default and malformed PGP/MIME outcomes', async () => {
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw: Buffer.from('headers only') }))).signed,
    false
  )
  assert.equal((await message.processInboundOpenPgp(input())).signed, false)
  const missingBoundary = await message.processInboundOpenPgp(
    input({
      raw: Buffer.from('Content-Type: multipart/signed; protocol=application/pgp-signature\r\n\r\n')
    })
  )
  assert.equal(missingBoundary.error, 'Signed message boundary is missing')
  const incomplete = await message.processInboundOpenPgp(
    input({
      raw: Buffer.from(
        'Content-Type: multipart/signed; protocol=application/pgp-signature; boundary=x\r\n\r\n--x--'
      )
    })
  )
  assert.equal(incomplete.error, 'Signed message is incomplete')
  const ignoredBoundary = await message.processInboundOpenPgp(
    input({
      raw: Buffer.from(
        'Content-Type: multipart/signed; protocol=application/pgp-signature; boundary=x\r\n\r\nnot-a-boundary--x\r\n--x--'
      )
    })
  )
  assert.equal(ignoredBoundary.error, 'Signed message is incomplete')
  const unterminatedBoundary = await message.processInboundOpenPgp(
    input({
      raw: Buffer.from(
        'Content-Type: multipart/signed; protocol=application/pgp-signature; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nbody'
      )
    })
  )
  assert.equal(unterminatedBoundary.error, 'Signed message is incomplete')
  const encrypted = await message.processInboundOpenPgp(
    input({
      raw: Buffer.from(
        'Content-Type: multipart/encrypted; protocol=application/pgp-encrypted; boundary=x\r\n\r\n--x\r\n\r\n--x--'
      )
    })
  )
  assert.equal(encrypted.error, 'Encrypted message is incomplete')
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({
          raw: Buffer.from(
            'Content-Type: multipart/encrypted; protocol=application/pgp-encrypted\r\n\r\nbody'
          )
        })
      )
    ).error,
    'Encrypted message is incomplete'
  )
})

test('verifies MIME signatures with trust, identity, and verification outcomes', async () => {
  const raw = Buffer.from(
    'Content-Type: multipart/signed; protocol=application/pgp-signature; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nbody\r\n--x\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nsig=20\r\n--x--\r\n'
  )
  state.verifyResult = { data: '', signatures: [signature()] }
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({
          raw,
          senderAddress: ' alice@example.com ',
          trustedFingerprints: new Set(['fingerprint-key'])
        })
      )
    ).signatureStatus,
    'valid'
  )
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw, senderAddress: 'other@example.com' })))
      .signatureStatus,
    'valid-mismatch'
  )
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw }))).signatureStatus,
    'valid-untrusted'
  )
  state.verifyResult = {
    data: '',
    signatures: [signature('MISSING', Promise.reject(new Error('bad')))]
  }
  assert.equal((await message.processInboundOpenPgp(input({ raw }))).signatureStatus, 'unknown')
  state.verifyResult = {
    data: '',
    signatures: [signature('KEY', Promise.reject(new Error('bad')))]
  }
  assert.equal((await message.processInboundOpenPgp(input({ raw }))).signatureStatus, 'invalid')
  state.verifyResult = { data: '', signatures: [] }
  assert.equal((await message.processInboundOpenPgp(input({ raw }))).signatureStatus, 'unknown')
  state.verifyResult = { data: '', signatures: [signature()] }
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw, verificationKeys: [key('KEY', [])] })))
      .signer,
    null
  )
  state.failVerify = 'broken'
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw, verificationKeys: [] }))).signatureStatus,
    'unknown'
  )
  state.failVerify = new Error('broken')
  assert.equal((await message.processInboundOpenPgp(input({ raw }))).signatureStatus, 'invalid')
})

test('decrypts MIME armored and binary payloads and preserves decrypt failures', async () => {
  const mime = (payload: string) =>
    Buffer.from(
      `Content-Type: multipart/encrypted; protocol=application/pgp-encrypted; boundary=x\r\n\r\n--x\r\n\r\nVersion: 1\r\n--x\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(payload).toString('base64')}\r\n--x--\r\n`
    )
  assert.match(
    (await message.processInboundOpenPgp(input({ raw: mime('binary'), verificationKeys: [] })))
      .error ?? '',
    /No private key/
  )
  state.decryptResult = {
    data: 'Content-Type: text/plain\r\n\r\ndecrypted',
    signatures: [signature()]
  }
  const decrypted = await message.processInboundOpenPgp(
    input({ raw: mime('-----BEGIN PGP MESSAGE-----\narmored'), privateKeys: [key()] })
  )
  assert.equal(decrypted.decrypted, true)
  assert.equal(decrypted.signatureStatus, 'valid-untrusted')
  state.decryptResult = { data: 'Content-Type: text/plain\r\n\r\nunsigned', signatures: [] }
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw: mime('binary'), privateKeys: [key()] })))
      .signed,
    false
  )
  state.failDecrypt = new Error('cannot decrypt')
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw: mime('binary'), privateKeys: [key()] })))
      .error,
    'cannot decrypt'
  )
  state.failDecrypt = 'string failure'
  assert.equal(
    (await message.processInboundOpenPgp(input({ raw: mime('binary'), privateKeys: [key()] })))
      .error,
    'string failure'
  )
})

test('processes inline encryption, cleartext signatures, and detached signatures', async () => {
  const armored = '-----BEGIN PGP MESSAGE-----\nvalue'
  assert.match(
    (await message.processInboundOpenPgp(input({ text: armored }))).error ?? '',
    /No private key/
  )
  state.decryptResult = { data: 'inline', signatures: [] }
  assert.equal(
    (await message.processInboundOpenPgp(input({ text: armored, privateKeys: [key()] }))).decrypted,
    true
  )
  state.failDecrypt = 'inline failure'
  assert.equal(
    (await message.processInboundOpenPgp(input({ text: armored, privateKeys: [key()] }))).error,
    'inline failure'
  )
  state.failDecrypt = null
  const clear = '-----BEGIN PGP SIGNED MESSAGE-----\ntext'
  state.verifyResult = { data: 'clear body', signatures: [signature()] }
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({
          text: clear,
          senderAddress: 'alice@example.com',
          trustedFingerprints: new Set(['fingerprint-key'])
        })
      )
    ).signatureStatus,
    'valid'
  )
  state.failVerify = new Error('clear failure')
  assert.equal((await message.processInboundOpenPgp(input({ text: clear }))).error, 'clear failure')
  assert.equal(
    (await message.processInboundOpenPgp(input({ text: clear, verificationKeys: [] })))
      .signatureStatus,
    'unknown'
  )
  state.failVerify = 'clear string failure'
  assert.equal(
    (await message.processInboundOpenPgp(input({ text: clear }))).error,
    'clear string failure'
  )
  state.failVerify = null
  state.verifyResult = { data: '', signatures: [signature()] }
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({
          text: 'text',
          detachedSignatures: [Buffer.from('-----BEGIN PGP SIGNATURE-----\nsig')]
        })
      )
    ).signed,
    true
  )
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({ text: 'text', detachedSignatures: [Buffer.from('binary')] })
      )
    ).signed,
    true
  )
  state.failVerify = 'detached failure'
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({ text: 'text', detachedSignatures: [Buffer.from('binary')], verificationKeys: [] })
      )
    ).signatureStatus,
    'unknown'
  )
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({ text: 'text', detachedSignatures: [Buffer.from('binary')] })
      )
    ).signatureStatus,
    'invalid'
  )
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({ text: 'text', detachedSignatures: [Buffer.from('binary')] })
      )
    ).error,
    'detached failure'
  )
  state.failVerify = new Error('detached error')
  assert.equal(
    (
      await message.processInboundOpenPgp(
        input({ text: 'text', detachedSignatures: [Buffer.from('binary')] })
      )
    ).error,
    'detached error'
  )
})
