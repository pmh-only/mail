import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import {
  decryptKey,
  generateKey,
  readKey,
  readPrivateKey,
  type PrivateKey,
  type PublicKey
} from 'openpgp'
import { db } from './db'
import { mailMessageMailbox, openPgpKey } from './db/schema'
import { lookupOpenPgpKeysByEmail, openPgpKeyEmails } from './openpgp-keyservers.ts'
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured } from './secrets'

const EMAIL_RE = /<([^<>\s@]+@[^<>\s@]+)>/

export type OpenPgpKeySummary = {
  id: number
  fingerprint: string
  name: string
  email: string
  userIds: string[]
  isOwn: boolean
  isDefault: boolean
  hasPrivateKey: boolean
  createdAt: string
}

function identityFromUserIds(userIds: string[]) {
  const primary = userIds[0]?.trim() ?? ''
  const email =
    primary.match(EMAIL_RE)?.[1]?.toLowerCase() ??
    (/^[^<>\s@]+@[^<>\s@]+$/.test(primary) ? primary.toLowerCase() : '')
  const name = email === primary.toLowerCase() ? '' : primary.replace(EMAIL_RE, '').trim()
  return { name, email }
}

function confirmedEncryptionEmails(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((email): email is string => typeof email === 'string')
    }
  } catch {
    // Legacy values stored one address directly.
  }
  return [value]
}

function serializeKey(row: typeof openPgpKey.$inferSelect, userIds: string[]): OpenPgpKeySummary {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    name: row.name,
    email: row.email,
    userIds,
    isOwn: row.isOwn,
    isDefault: row.isDefault,
    hasPrivateKey: Boolean(row.privateKey),
    createdAt: row.createdAt.toISOString()
  }
}

export async function listOpenPgpKeys(): Promise<OpenPgpKeySummary[]> {
  const rows = await db.select().from(openPgpKey).orderBy(asc(openPgpKey.createdAt))
  return Promise.all(
    rows.map(async (row) => {
      const key = await readKey({ armoredKey: row.publicKey })
      return serializeKey(row, key.getUserIDs())
    })
  )
}

async function saveKey(input: {
  publicKey: string
  privateKey?: string | null
  passphrase?: string | null
  isOwn: boolean
  makeDefault?: boolean
  encryptionEmail?: string
  encryptionSource?: string
}) {
  const publicKey = await readKey({ armoredKey: input.publicKey })
  const fingerprint = publicKey.getFingerprint().toLowerCase()
  const userIds = publicKey.getUserIDs()
  const identity = identityFromUserIds(userIds)
  const [existing] = await db
    .select()
    .from(openPgpKey)
    .where(eq(openPgpKey.fingerprint, fingerprint))
    .limit(1)
  const isOwn = input.isOwn || existing?.isOwn === true
  const isDefault = input.isOwn ? input.makeDefault !== false : (existing?.isDefault ?? false)
  const encryptionEmail = input.encryptionEmail
    ? JSON.stringify(
        Array.from(
          new Set([...confirmedEncryptionEmails(existing?.encryptionEmail), input.encryptionEmail])
        )
      )
    : undefined

  if (isOwn && isDefault && (!existing || !existing.isDefault)) {
    await db.update(openPgpKey).set({ isDefault: false }).where(eq(openPgpKey.isOwn, true))
  }

  const [row] = await db
    .insert(openPgpKey)
    .values({
      fingerprint,
      ...identity,
      publicKey: publicKey.armor(),
      privateKey: input.privateKey ? encryptSecret(input.privateKey) : null,
      passphrase: input.passphrase ? encryptSecret(input.passphrase) : null,
      isOwn,
      isDefault,
      encryptionEmail,
      encryptionConfirmedAt: input.encryptionEmail ? new Date() : undefined,
      encryptionSource: input.encryptionSource
    })
    .onConflictDoUpdate({
      target: openPgpKey.fingerprint,
      set: {
        ...identity,
        publicKey: publicKey.armor(),
        ...(input.privateKey
          ? {
              privateKey: encryptSecret(input.privateKey),
              passphrase: input.passphrase ? encryptSecret(input.passphrase) : null
            }
          : {}),
        isOwn,
        isDefault,
        ...(input.encryptionEmail
          ? {
              encryptionEmail,
              encryptionConfirmedAt: new Date(),
              encryptionSource: input.encryptionSource
            }
          : {}),
        updatedAt: new Date()
      }
    })
    .returning()

  if (!row) throw new Error('Unable to save OpenPGP key')
  await db
    .update(mailMessageMailbox)
    .set({ openPgpProcessedAt: null })
    .where(
      or(
        inArray(mailMessageMailbox.openPgpSignatureStatus, [
          'unknown',
          'invalid',
          'valid-untrusted',
          'valid-mismatch'
        ]),
        and(
          eq(mailMessageMailbox.openPgpEncrypted, true),
          eq(mailMessageMailbox.openPgpDecrypted, false)
        )
      )
    )
  return serializeKey(row, userIds)
}

export async function importOpenPgpKey(input: {
  armoredKey: string
  passphrase?: string
  isOwn?: boolean
  makeDefault?: boolean
}) {
  const armoredKey = input.armoredKey.trim()
  if (armoredKey.length > 2_000_000) throw new Error('OpenPGP key is too large')

  if (armoredKey.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    if (!isSecretEncryptionConfigured()) {
      throw new Error('MAIL_SECRET_KEY must be configured before importing a private key')
    }
    const privateKey = await readPrivateKey({ armoredKey })
    const passphrase = input.passphrase ?? ''
    if (!privateKey.isDecrypted()) {
      if (!passphrase) throw new Error('This private key requires a passphrase')
      await decryptKey({ privateKey, passphrase })
    }
    return saveKey({
      publicKey: privateKey.toPublic().armor(),
      privateKey: armoredKey,
      passphrase,
      isOwn: input.isOwn !== false,
      makeDefault: input.makeDefault
    })
  }

  const publicKey = await readKey({ armoredKey })
  return saveKey({
    publicKey: publicKey.armor(),
    isOwn: Boolean(input.isOwn),
    makeDefault: input.makeDefault
  })
}

export async function generateOpenPgpKey(input: {
  name: string
  email: string
  passphrase?: string
  algorithm?: 'curve25519' | 'rsa4096'
}) {
  if (!isSecretEncryptionConfigured()) {
    throw new Error('MAIL_SECRET_KEY must be configured before generating a private key')
  }
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('A valid name and email are required')
  if ((input.passphrase?.length ?? 0) > 1024) throw new Error('Passphrase is too long')

  const generated =
    input.algorithm === 'rsa4096'
      ? await generateKey({
          type: 'rsa',
          rsaBits: 4096,
          userIDs: [{ name, email }],
          passphrase: input.passphrase || undefined,
          format: 'armored'
        })
      : await generateKey({
          type: 'curve25519',
          userIDs: [{ name, email }],
          passphrase: input.passphrase || undefined,
          format: 'armored'
        })
  return saveKey({
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    passphrase: input.passphrase,
    isOwn: true,
    makeDefault: true
  })
}

export async function deleteOpenPgpKey(id: number) {
  const [deleted] = await db
    .delete(openPgpKey)
    .where(eq(openPgpKey.id, id))
    .returning({ id: openPgpKey.id, fingerprint: openPgpKey.fingerprint })
  if (deleted) {
    await db
      .update(mailMessageMailbox)
      .set({ openPgpProcessedAt: null })
      .where(eq(mailMessageMailbox.openPgpFingerprint, deleted.fingerprint))
  }
  return Boolean(deleted)
}

export async function markOpenPgpKeyAsPrimarySigningKey(id: number) {
  return db.transaction(async (tx) => {
    const [key] = await tx
      .select({ isOwn: openPgpKey.isOwn, privateKey: openPgpKey.privateKey })
      .from(openPgpKey)
      .where(eq(openPgpKey.id, id))
      .limit(1)
    if (!key) return 'not-found' as const
    if (!key.isOwn || !key.privateKey) return 'not-signing-key' as const

    await tx.update(openPgpKey).set({ isDefault: false }).where(eq(openPgpKey.isOwn, true))
    await tx
      .update(openPgpKey)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(openPgpKey.id, id))
    return 'updated' as const
  })
}

export async function getOpenPgpPublicKey(id: number) {
  const [row] = await db
    .select({ publicKey: openPgpKey.publicKey, fingerprint: openPgpKey.fingerprint })
    .from(openPgpKey)
    .where(eq(openPgpKey.id, id))
    .limit(1)
  return row ?? null
}

export async function getOpenPgpPublicKeys(): Promise<PublicKey[]> {
  const rows = await db.select({ publicKey: openPgpKey.publicKey }).from(openPgpKey)
  const keys = await Promise.all(
    rows.map(async (row) => {
      try {
        return await readKey({ armoredKey: row.publicKey })
      } catch {
        return null
      }
    })
  )
  return keys.filter((key): key is PublicKey => key !== null)
}

export async function getOpenPgpKeyForAddress(address: string): Promise<{
  privateKey: PrivateKey
  publicKey: PublicKey
  armoredPublicKey: string
} | null> {
  const normalizedAddress = address.trim().toLowerCase()
  const rows = await db.select().from(openPgpKey).where(eq(openPgpKey.isOwn, true))
  const matching: typeof rows = []
  for (const row of rows) {
    if (!row.privateKey) continue
    try {
      const publicKey = await readKey({ armoredKey: row.publicKey })
      if (openPgpKeyEmails(publicKey).includes(normalizedAddress)) {
        matching.push(row)
      }
    } catch {
      // Invalid stored keys are omitted from sender resolution.
    }
  }
  const row = matching.find((candidate) => candidate.isDefault) ?? matching[0]
  if (!row?.privateKey) return null

  let privateKey = await readPrivateKey({ armoredKey: decryptSecret(row.privateKey) })
  if (!privateKey.isDecrypted()) {
    const passphrase = decryptSecret(row.passphrase)
    if (!passphrase) throw new Error('OpenPGP private key passphrase is unavailable')
    privateKey = await decryptKey({ privateKey, passphrase })
  }
  return { privateKey, publicKey: privateKey.toPublic(), armoredPublicKey: row.publicKey }
}

export async function getOpenPgpPrivateKeys(): Promise<PrivateKey[]> {
  const rows = await db.select().from(openPgpKey).where(eq(openPgpKey.isOwn, true))
  const keys = await Promise.all(
    rows.flatMap((row) =>
      row.privateKey
        ? [
            (async () => {
              try {
                let privateKey = await readPrivateKey({ armoredKey: decryptSecret(row.privateKey) })
                if (!privateKey.isDecrypted()) {
                  const passphrase = decryptSecret(row.passphrase)
                  if (!passphrase) return null
                  privateKey = await decryptKey({ privateKey, passphrase })
                }
                return privateKey
              } catch {
                return null
              }
            })()
          ]
        : []
    )
  )
  return keys.filter((key): key is PrivateKey => key !== null)
}

export async function getEncryptionKeysForAddresses(addresses: string[]) {
  const normalized = new Set(addresses.map((address) => address.trim().toLowerCase()))
  const matched = new Map<string, PublicKey>()
  const rows = await db
    .select()
    .from(openPgpKey)
    .where(or(eq(openPgpKey.isOwn, true), isNotNull(openPgpKey.encryptionConfirmedAt)))
  for (const row of rows) {
    try {
      const key = await readKey({ armoredKey: row.publicKey })
      try {
        await key.getEncryptionKey()
      } catch {
        continue
      }
      const allowedEmails = row.isOwn
        ? openPgpKeyEmails(key)
        : confirmedEncryptionEmails(row.encryptionEmail).map((email) => email.toLowerCase())
      for (const email of allowedEmails) {
        if (normalized.has(email) && !matched.has(email)) matched.set(email, key)
      }
    } catch {
      // Invalid or unusable stored keys are ignored.
    }
  }
  return {
    keys: Array.from(new Set(matched.values())),
    missing: addresses.filter((address) => !matched.has(address.trim().toLowerCase()))
  }
}

export async function discoverEncryptionKeyCandidates(addresses: string[]) {
  const candidates = []
  for (const email of addresses.map((value) => value.trim().toLowerCase())) {
    const keys = await lookupOpenPgpKeysByEmail(email, {
      requireEncryption: true,
      allowMultiple: true
    })
    for (const key of keys) {
      candidates.push({
        email,
        fingerprint: key.getFingerprint().toLowerCase(),
        userIds: key.getUserIDs(),
        armoredKey: key.armor(),
        source: 'public-keyserver'
      })
    }
  }
  return candidates
}

export async function confirmEncryptionKey(input: {
  email: string
  fingerprint: string
  armoredKey: string
  source: string
}) {
  const email = input.email.trim().toLowerCase()
  const key = await readKey({ armoredKey: input.armoredKey })
  if (key.getFingerprint().toLowerCase() !== input.fingerprint.toLowerCase()) {
    throw new Error('OpenPGP fingerprint changed')
  }
  if (!openPgpKeyEmails(key).includes(email))
    throw new Error('OpenPGP key does not contain this address')
  await key.getEncryptionKey()
  return saveKey({
    publicKey: key.armor(),
    isOwn: false,
    encryptionEmail: email,
    encryptionSource: input.source || 'public-keyserver'
  })
}
