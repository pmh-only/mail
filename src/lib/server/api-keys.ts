import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  bearerApiKey,
  rostackApiKey,
  generateApiKeyValue,
  hashApiKey,
  verifyApiKeyHash
} from '$lib/api-key-value'
import { db } from './db'
import { mailApiKey, user } from './db/schema'

export { bearerApiKey, rostackApiKey }

function serializeApiKey(row: typeof mailApiKey.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  }
}

export async function createApiKey(userId: string, name: string) {
  const key = generateApiKeyValue()
  const [row] = await db
    .insert(mailApiKey)
    .values({
      id: randomUUID(),
      userId,
      name,
      prefix: apiKeyPrefix(key),
      keyHash: await hashApiKey(key)
    })
    .returning()

  return { ...serializeApiKey(row), key }
}

export async function listApiKeys(userId: string) {
  const rows = await db
    .select()
    .from(mailApiKey)
    .where(eq(mailApiKey.userId, userId))
    .orderBy(desc(mailApiKey.createdAt))
  return rows.map(serializeApiKey)
}

export async function revokeApiKey(userId: string, id: string) {
  const rows = await db
    .delete(mailApiKey)
    .where(and(eq(mailApiKey.id, id), eq(mailApiKey.userId, userId)))
    .returning({ id: mailApiKey.id })
  return rows.length > 0
}

export async function verifyApiKey(value: string) {
  if (!value.startsWith(API_KEY_PREFIX)) return null
  const [row] = await db
    .select({
      id: mailApiKey.id,
      userId: mailApiKey.userId,
      user,
      keyHash: mailApiKey.keyHash
    })
    .from(mailApiKey)
    .innerJoin(user, eq(mailApiKey.userId, user.id))
    .where(eq(mailApiKey.prefix, apiKeyPrefix(value)))
    .limit(1)
  if (!row || !(await verifyApiKeyHash(value, row.keyHash))) return null

  await db.update(mailApiKey).set({ lastUsedAt: new Date() }).where(eq(mailApiKey.id, row.id))
  return { id: row.id, userId: row.userId, user: row.user }
}
