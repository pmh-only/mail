import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

type Key = {
  fingerprint: string
  userIds: string[]
  armor: string
  encryption?: boolean
}

const state = vi.hoisted(() => {
  const selections: unknown[][] = []
  const insertions: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const deletions: unknown[][] = []
  const publicKeys = new Map<string, Key>()
  const privateKeys = new Map<string, { decrypted: boolean; publicKey: Key }>()
  const discovered = new Map<string, unknown[]>()
  type Query = Promise<unknown[]> & {
    from: () => Query
    where: () => Query
    orderBy: () => Promise<unknown[]>
    limit: () => Promise<unknown[]>
  }
  const query = (result: unknown[]) => {
    const chain = Promise.resolve(result) as Query
    Object.assign(chain, {
      from: () => chain,
      where: () => chain,
      orderBy: async () => result,
      limit: async () => result
    })
    return chain
  }
  const db = {
    select: vi.fn(() => query(selections.shift() ?? [])),
    insert: vi.fn(() => {
      const chain = {
        values: (value: Record<string, unknown>) => {
          insertions.push(value)
          return chain
        },
        onConflictDoUpdate: () => chain,
        returning: async () => selections.shift() ?? []
      }
      return chain
    }),
    update: vi.fn(() => {
      const chain = {
        set: (value: Record<string, unknown>) => {
          updates.push(value)
          return chain
        },
        where: async () => undefined
      }
      return chain
    }),
    delete: vi.fn(() => {
      const chain = {
        where: () => chain,
        returning: async () => deletions.shift() ?? []
      }
      return chain
    }),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db))
  }
  return {
    selections,
    insertions,
    updates,
    deletions,
    publicKeys,
    privateKeys,
    discovered,
    db,
    secretConfigured: true,
    generateResult: null as { publicKey: string; privateKey: string } | null,
    generateKey: vi.fn()
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./secrets', () => ({
  decryptSecret: (value: string | null | undefined) => value ?? '',
  encryptSecret: (value: string) => `encrypted:${value}`,
  isSecretEncryptionConfigured: () => state.secretConfigured
}))
vi.mock('./openpgp-keyservers.ts', () => ({
  openPgpKeyEmails: (key: { getUserIDs: () => string[] }) =>
    key
      .getUserIDs()
      .map((userId) => userId.match(/<([^>]+)>/)?.[1] ?? userId)
      .map((email) => email.toLowerCase()),
  lookupOpenPgpKeysByEmail: async (email: string) => state.discovered.get(email) ?? []
}))
vi.mock('openpgp', () => ({
  readKey: async ({ armoredKey }: { armoredKey: string }) => {
    const key = state.publicKeys.get(armoredKey)
    if (!key) throw new Error('invalid public key')
    return {
      getFingerprint: () => key.fingerprint,
      getUserIDs: () => key.userIds,
      armor: () => key.armor,
      getEncryptionKey: async () => {
        if (key.encryption === false) throw new Error('not encryption capable')
        return key
      }
    }
  },
  readPrivateKey: async ({ armoredKey }: { armoredKey: string }) => {
    const key = state.privateKeys.get(armoredKey)
    if (!key) throw new Error('invalid private key')
    return {
      isDecrypted: () => key.decrypted,
      toPublic: () => ({ armor: () => key.publicKey.armor }),
      publicKey: key.publicKey
    }
  },
  decryptKey: async ({
    privateKey,
    passphrase
  }: {
    privateKey: { publicKey: Key }
    passphrase: string
  }) => {
    if (passphrase === 'bad') throw new Error('bad passphrase')
    return {
      isDecrypted: () => true,
      toPublic: () => ({ armor: () => privateKey.publicKey.armor })
    }
  },
  generateKey: state.generateKey
}))

const keys = await import('./openpgp-keys.ts')
const openpgp = await import('openpgp')

function key(
  armor: string,
  fingerprint = armor,
  userIds = ['Alice <alice@example.com>'],
  encryption = true
) {
  const value = { armor, fingerprint, userIds, encryption }
  state.publicKeys.set(armor, value)
  return value
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    fingerprint: 'fingerprint',
    name: 'Alice',
    email: 'alice@example.com',
    publicKey: 'public',
    privateKey: null,
    passphrase: null,
    isOwn: false,
    isDefault: false,
    encryptionEmail: null,
    encryptionConfirmedAt: null,
    createdAt: new Date('2024-01-02T03:04:05.000Z'),
    ...overrides
  }
}

beforeEach(() => {
  state.selections.length = 0
  state.insertions.length = 0
  state.updates.length = 0
  state.deletions.length = 0
  state.publicKeys.clear()
  state.privateKeys.clear()
  state.discovered.clear()
  state.secretConfigured = true
  state.generateResult = null
  state.generateKey.mockImplementation(async () => state.generateResult)
  vi.clearAllMocks()
})

test('lists stored keys with parsed user IDs and private-key status', async () => {
  key('public')
  state.selections.push([row({ privateKey: 'private' })])

  assert.deepEqual(await keys.listOpenPgpKeys(), [
    {
      id: 1,
      fingerprint: 'fingerprint',
      name: 'Alice',
      email: 'alice@example.com',
      userIds: ['Alice <alice@example.com>'],
      isOwn: false,
      isDefault: false,
      hasPrivateKey: true,
      createdAt: '2024-01-02T03:04:05.000Z'
    }
  ])
})

test('lists keys without a user ID', async () => {
  key('anonymous', 'anonymous', [])
  state.selections.push([row({ publicKey: 'anonymous', name: '', email: '' })])

  assert.deepEqual((await keys.listOpenPgpKeys())[0]?.userIds, [])
})

test('imports public keys, preserves existing ownership, and records confirmed addresses', async () => {
  key('public', 'FINGERPRINT', ['person@example.com'])
  state.selections.push([row({ isOwn: true, isDefault: true, encryptionEmail: 'old@example.com' })])
  state.selections.push([
    row({
      fingerprint: 'fingerprint',
      name: '',
      email: 'person@example.com',
      isOwn: true,
      isDefault: true
    })
  ])

  const saved = await keys.confirmEncryptionKey({
    email: ' Person@Example.com ',
    fingerprint: 'fingerprint',
    armoredKey: 'public',
    source: 'manual'
  })

  assert.equal(saved.email, 'person@example.com')
  const insertion = state.insertions[0]
  assert.ok(insertion?.encryptionConfirmedAt instanceof Date)
  assert.deepEqual(
    { ...insertion, encryptionConfirmedAt: undefined },
    {
      fingerprint: 'fingerprint',
      name: '',
      email: 'person@example.com',
      publicKey: 'public',
      privateKey: null,
      passphrase: null,
      isOwn: true,
      isDefault: true,
      encryptionEmail: JSON.stringify(['old@example.com', 'person@example.com']),
      encryptionConfirmedAt: undefined,
      encryptionSource: 'manual'
    }
  )
  assert.equal(state.updates.length, 1)
})

test('rejects invalid imports and validates locked private keys before saving them', async () => {
  await assert.rejects(keys.importOpenPgpKey({ armoredKey: 'x'.repeat(2_000_001) }), /too large/)
  state.secretConfigured = false
  await assert.rejects(
    keys.importOpenPgpKey({ armoredKey: 'BEGIN PGP PRIVATE KEY BLOCK private' }),
    /MAIL_SECRET_KEY/
  )

  state.secretConfigured = true
  const publicKey = key('public')
  state.privateKeys.set('BEGIN PGP PRIVATE KEY BLOCK private', { decrypted: false, publicKey })
  await assert.rejects(
    keys.importOpenPgpKey({ armoredKey: 'BEGIN PGP PRIVATE KEY BLOCK private' }),
    /requires a passphrase/
  )
  state.selections.push([])
  state.selections.push([row({ isOwn: true, isDefault: true, privateKey: 'stored' })])
  await keys.importOpenPgpKey({
    armoredKey: 'BEGIN PGP PRIVATE KEY BLOCK private',
    passphrase: 'passphrase'
  })
  assert.equal(state.insertions[0]?.privateKey, 'encrypted:BEGIN PGP PRIVATE KEY BLOCK private')
  assert.equal(state.insertions[0]?.passphrase, 'encrypted:passphrase')
})

test('returns an error when saving cannot return a row', async () => {
  key('public')
  state.selections.push([], [])
  await assert.rejects(keys.importOpenPgpKey({ armoredKey: 'public' }), /Unable to save/)
})

test('imports a public-only key without making it an own or default key', async () => {
  key('public', 'PUBLIC', ['Public <public@example.com>'])
  state.selections.push([], [row({ fingerprint: 'public', email: 'public@example.com' })])

  await keys.importOpenPgpKey({ armoredKey: ' public ', isOwn: false, makeDefault: true })

  assert.equal(state.insertions[0]?.isOwn, false)
  assert.equal(state.insertions[0]?.isDefault, false)
  assert.equal(state.updates.length, 1)

  key('anonymous', 'ANONYMOUS', [])
  state.selections.push([], [row({ fingerprint: 'anonymous', name: '', email: '' })])
  await keys.importOpenPgpKey({ armoredKey: 'anonymous' })
  assert.equal(state.insertions[1]?.email, '')
})

test('generates default curve and RSA keys and validates generation input', async () => {
  state.secretConfigured = false
  await assert.rejects(
    keys.generateOpenPgpKey({ name: 'Alice', email: 'alice@example.com' }),
    /MAIL_SECRET_KEY/
  )
  state.secretConfigured = true
  await assert.rejects(keys.generateOpenPgpKey({ name: ' ', email: 'bad' }), /valid name/)
  await assert.rejects(
    keys.generateOpenPgpKey({
      name: 'Alice',
      email: 'alice@example.com',
      passphrase: 'x'.repeat(1025)
    }),
    /too long/
  )

  state.generateResult = { publicKey: 'generated-public', privateKey: 'generated-private' }
  key('generated-public', 'generated-fingerprint', ['Alice <alice@example.com>'])
  state.selections.push([], [row({ isOwn: true, isDefault: true, privateKey: 'private' })])
  await keys.generateOpenPgpKey({
    name: ' Alice ',
    email: ' ALICE@example.com ',
    passphrase: 'pass'
  })
  assert.deepEqual(state.generateKey.mock.calls[0]?.[0], {
    type: 'curve25519',
    userIDs: [{ name: 'Alice', email: 'alice@example.com' }],
    passphrase: 'pass',
    format: 'armored'
  })

  state.selections.push([], [row({ isOwn: true, isDefault: true, privateKey: 'private' })])
  await keys.generateOpenPgpKey({ name: 'Alice', email: 'alice@example.com', algorithm: 'rsa4096' })
  assert.equal(state.generateKey.mock.calls[1]?.[0].rsaBits, 4096)

  state.selections.push([], [row({ isOwn: true, isDefault: true, privateKey: 'private' })])
  await keys.generateOpenPgpKey({ name: 'Alice', email: 'alice@example.com' })
  assert.equal(state.generateKey.mock.calls[2]?.[0].passphrase, undefined)
})

test('deletes keys, updates affected mail, and returns whether a key existed', async () => {
  state.deletions.push([{ id: 1, fingerprint: 'deleted' }], [])
  assert.equal(await keys.deleteOpenPgpKey(1), true)
  assert.equal(await keys.deleteOpenPgpKey(2), false)
  assert.equal(state.updates.length, 1)
})

test('marks only own private keys as the primary signing key', async () => {
  state.selections.push(
    [],
    [{ isOwn: false, privateKey: 'private' }],
    [{ isOwn: true, privateKey: 'private' }]
  )
  assert.equal(await keys.markOpenPgpKeyAsPrimarySigningKey(1), 'not-found')
  assert.equal(await keys.markOpenPgpKeyAsPrimarySigningKey(2), 'not-signing-key')
  assert.equal(await keys.markOpenPgpKeyAsPrimarySigningKey(3), 'updated')
  assert.equal(state.updates.length, 2)
})

test('gets public keys and ignores malformed stored certificates', async () => {
  state.selections.push([{ publicKey: 'public', fingerprint: 'fingerprint' }], [])
  assert.deepEqual(await keys.getOpenPgpPublicKey(1), {
    publicKey: 'public',
    fingerprint: 'fingerprint'
  })
  assert.equal(await keys.getOpenPgpPublicKey(2), null)

  const valid = key('valid')
  state.selections.push([{ publicKey: 'valid' }, { publicKey: 'invalid' }])
  const result = await keys.getOpenPgpPublicKeys()
  assert.equal(result.length, 1)
  assert.equal(result[0]?.getFingerprint(), valid.fingerprint)
})

test('resolves the default matching signing key and handles locked or invalid records', async () => {
  const first = key('first', 'first', ['First <sender@example.com>'])
  const preferred = key('preferred', 'preferred', ['Preferred <sender@example.com>'])
  key('other', 'other', ['Other <other@example.com>'])
  state.privateKeys.set('first-private', { decrypted: true, publicKey: first })
  state.privateKeys.set('preferred-private', { decrypted: false, publicKey: preferred })
  state.selections.push([
    row({ publicKey: 'broken', privateKey: 'broken-private' }),
    row({ publicKey: 'other', privateKey: 'other-private' }),
    row({ publicKey: 'first', privateKey: 'first-private' }),
    row({
      publicKey: 'preferred',
      privateKey: 'preferred-private',
      passphrase: 'pass',
      isDefault: true
    })
  ])
  const resolved = await keys.getOpenPgpKeyForAddress(' SENDER@example.com ')
  assert.equal(resolved?.armoredPublicKey, 'preferred')

  state.selections.push([
    row({ publicKey: 'first', privateKey: 'first-private', passphrase: null })
  ])
  state.privateKeys.set('first-private', { decrypted: false, publicKey: first })
  await assert.rejects(
    keys.getOpenPgpKeyForAddress('sender@example.com'),
    /passphrase is unavailable/
  )
  state.selections.push([row({ publicKey: 'first', privateKey: null })])
  assert.equal(await keys.getOpenPgpKeyForAddress('sender@example.com'), null)
  state.privateKeys.set('first-private', { decrypted: true, publicKey: first })
  state.selections.push([row({ publicKey: 'first', privateKey: 'first-private' })])
  assert.equal(
    (await keys.getOpenPgpKeyForAddress('sender@example.com'))?.armoredPublicKey,
    'first'
  )
  state.selections.push([row({ publicKey: 'first', privateKey: 'missing-private' })])
  await assert.rejects(keys.getOpenPgpKeyForAddress('sender@example.com'), /invalid private key/)
})

test('returns usable private keys while omitting inaccessible and invalid records', async () => {
  const decrypted = key('decrypted')
  const locked = key('locked')
  state.privateKeys.set('decrypted-private', { decrypted: true, publicKey: decrypted })
  state.privateKeys.set('locked-private', { decrypted: false, publicKey: locked })
  state.privateKeys.set('locked-with-passphrase', { decrypted: false, publicKey: locked })
  state.selections.push([
    row({ privateKey: null }),
    row({ privateKey: 'decrypted-private' }),
    row({ privateKey: 'locked-private', passphrase: null }),
    row({ privateKey: 'locked-with-passphrase', passphrase: 'pass' }),
    row({ privateKey: 'invalid-private' })
  ])
  assert.equal((await keys.getOpenPgpPrivateKeys()).length, 2)
})

test('selects encryption keys only for owned or confirmed matching addresses', async () => {
  const owned = key('owned', 'owned', ['Owner <owner@example.com>'])
  const confirmed = key('confirmed', 'confirmed', ['Other <other@example.com>'])
  key('not-encryption', 'not-encryption', ['No <no@example.com>'], false)
  state.selections.push([
    row({ publicKey: 'owned', isOwn: true }),
    row({ publicKey: 'owned', isOwn: true }),
    row({
      publicKey: 'confirmed',
      encryptionEmail: '["confirmed@example.com", 4]',
      encryptionConfirmedAt: new Date()
    }),
    row({ publicKey: 'not-encryption', isOwn: true }),
    row({ publicKey: 'invalid', isOwn: true })
  ])
  const result = await keys.getEncryptionKeysForAddresses([
    ' OWNER@example.com ',
    'confirmed@example.com',
    'missing@example.com',
    'owner@example.com'
  ])
  assert.deepEqual(
    result.keys.map((value) => value.getFingerprint()),
    [owned.fingerprint, confirmed.fingerprint]
  )
  assert.deepEqual(result.missing, ['missing@example.com'])
})

test('discovers candidates and confirms only matching usable encryption keys', async () => {
  key('candidate', 'CANDIDATE', ['Candidate <candidate@example.com>'])
  const candidate = await openpgp.readKey({ armoredKey: 'candidate' })
  state.discovered.set('candidate@example.com', [candidate])
  assert.deepEqual(await keys.discoverEncryptionKeyCandidates([' Candidate@example.com ']), [
    {
      email: 'candidate@example.com',
      fingerprint: 'candidate',
      userIds: ['Candidate <candidate@example.com>'],
      armoredKey: 'candidate',
      source: 'public-keyserver'
    }
  ])

  await assert.rejects(
    keys.confirmEncryptionKey({
      email: 'candidate@example.com',
      fingerprint: 'wrong',
      armoredKey: 'candidate',
      source: ''
    }),
    /fingerprint changed/
  )
  const unrelated = key('unrelated', 'unrelated', ['Other <other@example.com>'])
  await assert.rejects(
    keys.confirmEncryptionKey({
      email: 'candidate@example.com',
      fingerprint: 'unrelated',
      armoredKey: unrelated.armor,
      source: ''
    }),
    /does not contain/
  )

  state.selections.push([], [row({ fingerprint: 'candidate' })])
  await keys.confirmEncryptionKey({
    email: 'candidate@example.com',
    fingerprint: 'candidate',
    armoredKey: 'candidate',
    source: ''
  })
  assert.equal(state.insertions[0]?.encryptionSource, 'public-keyserver')
})
