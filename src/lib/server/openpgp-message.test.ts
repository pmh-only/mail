import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMessage,
  encrypt,
  enums,
  generateKey,
  type PrivateKey,
  type PublicKey
} from 'openpgp'
import { simpleParser } from 'mailparser'
import {
  clearSignText,
  detachedSignText,
  encryptPgpMime,
  processInboundOpenPgp,
  signPgpMime
} from './openpgp-message.ts'
import { lookupOpenPgpKeysByEmail } from './openpgp-keyservers.ts'

const RAW_MESSAGE = Buffer.from(
  'From: Alice <alice@example.com>\r\n' +
    'To: Bob <bob@example.com>\r\n' +
    'Subject: Cryptographic test\r\n' +
    'Message-ID: <crypto-test@example.com>\r\n' +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    'Content-Transfer-Encoding: 7bit\r\n\r\n' +
    'A signed message.\r\n'
)

let privateKey: PrivateKey
let publicKey: PublicKey

test.before(async () => {
  const generated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Alice', email: 'alice@example.com' }],
    format: 'object'
  })
  privateKey = generated.privateKey
  publicKey = generated.publicKey
})

test('creates and verifies cleartext signatures', async () => {
  const signed = await clearSignText('A signed message.', privateKey)
  const result = await processInboundOpenPgp({
    raw: Buffer.from(`Content-Type: text/plain\r\n\r\n${signed}`),
    text: signed,
    privateKeys: [],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  assert.equal(result.signed, true)
  assert.equal(result.signatureStatus, 'valid')
  assert.equal(result.fingerprint, publicKey.getFingerprint())
})

test('creates and verifies detached signatures', async () => {
  const text = 'A signed message.'
  const signature = await detachedSignText(text, privateKey)
  const result = await processInboundOpenPgp({
    raw: RAW_MESSAGE,
    text,
    detachedSignatures: [Buffer.from(signature)],
    privateKeys: [],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  assert.equal(result.signed, true)
  assert.equal(result.signatureStatus, 'valid')
})

test('verifies PGP/MIME trust, identity, and tamper states', async () => {
  const signed = await signPgpMime(RAW_MESSAGE, privateKey)
  assert.match(signed.toString('utf8'), /micalg=pgp-sha512/)
  const verified = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  assert.equal(verified.signatureStatus, 'valid')
  const untrusted = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: [publicKey],
    trustedFingerprints: new Set(),
    senderAddress: 'alice@example.com'
  })
  assert.equal(untrusted.signatureStatus, 'valid-untrusted')
  const mismatched = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: [publicKey],
    senderAddress: 'mallory@example.com'
  })
  assert.equal(mismatched.signatureStatus, 'valid-mismatch')
  const matching = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  assert.equal(matching.signatureStatus, 'valid')
  const unrelated = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Bob', email: 'bob@example.com' }],
    format: 'object'
  })
  const unknown = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: [unrelated.publicKey]
  })
  assert.equal(unknown.signatureStatus, 'unknown')
  const noEmail = await generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'No Email' }],
    format: 'object'
  })
  const noEmailSigned = await signPgpMime(RAW_MESSAGE, noEmail.privateKey)
  const unboundIdentity = await processInboundOpenPgp({
    raw: noEmailSigned,
    privateKeys: [],
    verificationKeys: [noEmail.publicKey],
    senderAddress: 'victim@example.com'
  })
  assert.equal(unboundIdentity.signatureStatus, 'valid-mismatch')
  const tampered = Buffer.from(
    signed.toString('utf8').replace('A signed message.', 'A changed message.')
  )
  const rejected = await processInboundOpenPgp({
    raw: tampered,
    privateKeys: [],
    verificationKeys: [publicKey]
  })
  assert.equal(rejected.signatureStatus, 'invalid')
})

test('uses an automatically discovered certificate without trusting it', async () => {
  const signed = await signPgpMime(RAW_MESSAGE, privateKey)
  const fetchedKeys = await lookupOpenPgpKeysByEmail('alice@example.com', {
    fetch: async () => new Response(publicKey.armor()),
    cache: false
  })
  const result = await processInboundOpenPgp({
    raw: signed,
    privateKeys: [],
    verificationKeys: fetchedKeys,
    trustedFingerprints: new Set(),
    senderAddress: 'alice@example.com'
  })

  assert.equal(result.signatureStatus, 'valid-untrusted')
  assert.equal(result.fingerprint, publicKey.getFingerprint())
})

test('decrypts and verifies signed PGP/MIME messages', async () => {
  const encrypted = await encryptPgpMime(RAW_MESSAGE, [publicKey], privateKey)
  const result = await processInboundOpenPgp({
    raw: encrypted,
    privateKeys: [privateKey],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  assert.equal(result.encrypted, true)
  assert.equal(result.decrypted, true)
  assert.equal(result.signed, true)
  assert.equal(result.signatureStatus, 'valid')
  assert.match(result.rawMessage.toString('utf8'), /A signed message\./)
  assert.doesNotMatch(result.rawMessage.toString('utf8'), /BEGIN PGP MESSAGE/)
})

test('reports encrypted messages when no decryption key is available', async () => {
  const encrypted = await encryptPgpMime(RAW_MESSAGE, [publicKey])
  const result = await processInboundOpenPgp({
    raw: encrypted,
    privateKeys: [],
    verificationKeys: [publicKey]
  })
  assert.equal(result.encrypted, true)
  assert.equal(result.decrypted, false)
  assert.match(result.error ?? '', /No private key/)
})

test('decrypts inline armored OpenPGP messages into a renderable text body', async () => {
  const encrypted = String(
    await encrypt({
      message: await createMessage({ text: 'Inline encrypted content.' }),
      encryptionKeys: publicKey,
      signingKeys: privateKey,
      format: 'armored'
    })
  )
  const raw = Buffer.from(
    `From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Inline\r\nContent-Type: text/plain\r\n\r\n${encrypted}`
  )
  const result = await processInboundOpenPgp({
    raw,
    text: encrypted,
    privateKeys: [privateKey],
    verificationKeys: [publicKey],
    senderAddress: 'alice@example.com'
  })
  const parsed = await simpleParser(result.rawMessage)
  assert.equal(result.decrypted, true)
  assert.equal(result.signatureStatus, 'valid')
  assert.equal(parsed.text?.trim(), 'Inline encrypted content.')
})

test('rejects OpenPGP messages that decompress beyond the message size limit', async () => {
  const encrypted = String(
    await encrypt({
      message: await createMessage({ text: 'x'.repeat(25 * 1024 * 1024 + 1) }),
      encryptionKeys: publicKey,
      format: 'armored',
      config: { preferredCompressionAlgorithm: enums.compression.zlib }
    })
  )
  const raw = Buffer.from(`Content-Type: text/plain\r\n\r\n${encrypted}`)
  const result = await processInboundOpenPgp({
    raw,
    text: encrypted,
    privateKeys: [privateKey],
    verificationKeys: []
  })

  assert.equal(result.encrypted, true)
  assert.equal(result.decrypted, false)
  assert.match(result.error ?? '', /Maximum decompressed message size exceeded/)
  assert.match(result.rawMessage.toString('utf8'), /-----BEGIN PGP MESSAGE-----/)
})
