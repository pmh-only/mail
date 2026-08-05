import { and, asc, countDistinct, eq, inArray, notLike } from 'drizzle-orm'
import { db } from './db'
import { composedMailbox, mailMessage, mailMessageMailbox } from './db/schema'
import {
  COMPOSED_MAILBOX_SLUG_PREFIX,
  composedMailboxSlug,
  normalizeComposedMailboxIcon,
  normalizeComposedMailboxPaths
} from '../composed-mailbox'
import type { ComposedMailboxIcon } from '../composed-mailbox'

export {
  composedMailboxSlug,
  normalizeComposedMailboxIcon,
  normalizeComposedMailboxName,
  normalizeComposedMailboxPaths
} from '../composed-mailbox'

export type ComposedMailbox = {
  id: number
  name: string
  slug: string
  icon: ComposedMailboxIcon
  mailboxPaths: string[]
}

export class ComposedMailboxConflictError extends Error {}

export function isComposedMailboxConflict(cause: unknown) {
  return (
    cause instanceof ComposedMailboxConflictError ||
    (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505')
  )
}

function serialize(row: typeof composedMailbox.$inferSelect): ComposedMailbox {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: normalizeComposedMailboxIcon(row.icon),
    mailboxPaths: normalizeComposedMailboxPaths(row.mailboxPaths)
  }
}

export async function listComposedMailboxes() {
  const rows = await db.select().from(composedMailbox).orderBy(asc(composedMailbox.name))
  return rows.map(serialize)
}

export async function getComposedMailboxUnreadCounts(mailboxes: ComposedMailbox[]) {
  const entries = await Promise.all(
    mailboxes.map(async (mailbox) => {
      const [row] = await db
        .select({ value: countDistinct(mailMessage.threadKey) })
        .from(mailMessageMailbox)
        .innerJoin(mailMessage, eq(mailMessageMailbox.mailMessageId, mailMessage.id))
        .where(
          and(
            inArray(mailMessageMailbox.mailbox, mailbox.mailboxPaths),
            notLike(mailMessageMailbox.flags, '%\\\\Seen%')
          )
        )
      return [mailbox.slug, Number(row?.value ?? 0)] as const
    })
  )
  return Object.fromEntries(entries) as Record<string, number>
}

export async function getComposedMailboxBySlug(slug: string) {
  if (!slug.toLowerCase().startsWith(COMPOSED_MAILBOX_SLUG_PREFIX)) return null
  const [row] = await db
    .select()
    .from(composedMailbox)
    .where(eq(composedMailbox.slug, slug.toLowerCase()))
    .limit(1)
  return row ? serialize(row) : null
}

async function uniqueSlug(name: string, reservedSlugs: Set<string>) {
  const base = composedMailboxSlug(name)
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`
    if (reservedSlugs.has(slug)) continue
    const [existing] = await db
      .select({ id: composedMailbox.id })
      .from(composedMailbox)
      .where(eq(composedMailbox.slug, slug))
      .limit(1)
    if (!existing) return slug
  }
  throw new ComposedMailboxConflictError('Could not create a unique composed mailbox URL')
}

export async function createComposedMailbox(
  name: string,
  mailboxPaths: string[],
  reservedSlugs = new Set<string>(),
  icon: ComposedMailboxIcon = 'layers'
) {
  const [sameName] = await db
    .select({ id: composedMailbox.id })
    .from(composedMailbox)
    .where(eq(composedMailbox.name, name))
    .limit(1)
  if (sameName) throw new ComposedMailboxConflictError('A composed mailbox with this name exists')

  const [row] = await db
    .insert(composedMailbox)
    .values({ name, slug: await uniqueSlug(name, reservedSlugs), icon, mailboxPaths })
    .returning()
  return serialize(row)
}

export async function updateComposedMailbox(
  id: number,
  name: string,
  mailboxPaths: string[],
  icon: ComposedMailboxIcon = 'layers'
) {
  const [sameName] = await db
    .select({ id: composedMailbox.id })
    .from(composedMailbox)
    .where(eq(composedMailbox.name, name))
    .limit(1)
  if (sameName && sameName.id !== id) {
    throw new ComposedMailboxConflictError('A composed mailbox with this name exists')
  }

  const [row] = await db
    .update(composedMailbox)
    .set({ name, icon, mailboxPaths, updatedAt: new Date() })
    .where(eq(composedMailbox.id, id))
    .returning()
  return row ? serialize(row) : null
}

export async function deleteComposedMailbox(id: number) {
  const rows = await db
    .delete(composedMailbox)
    .where(eq(composedMailbox.id, id))
    .returning({ id: composedMailbox.id })
  return rows.length > 0
}
