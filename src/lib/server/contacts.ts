import { db } from '$lib/server/db'
import { mailContact, mailMessage } from '$lib/server/db/schema'
import { desc, eq, ilike, or, sql } from 'drizzle-orm'

export type ContactInput = {
  name: string
  email: string
  source?: 'auto' | 'manual'
  useCount?: number
  lastUsedAt?: Date | null
}

export type ContactRow = typeof mailContact.$inferSelect

export type ContactSuggestion = {
  id: number
  name: string
  email: string
  display: string
  source: string
  useCount: number
  lastUsedAt: string | null
  updatedAt: string
}

const EMAIL_RE = /([^<,;]*?)\s*<([^>]+)>/g
const BARE_EMAIL_RE = /[\w.+%-]+@[\w.-]+\.[a-z]{2,}/gi

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function cleanName(name: string) {
  return name.trim().replace(/^["']|["']$/g, '')
}

export function contactDisplay(contact: Pick<ContactInput, 'name' | 'email'>) {
  return contact.name ? `${contact.name} <${contact.email}>` : contact.email
}

export function parseAddressList(field: string | null | undefined): ContactInput[] {
  if (!field) return []

  const contacts: ContactInput[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  EMAIL_RE.lastIndex = 0
  while ((match = EMAIL_RE.exec(field)) !== null) {
    const name = cleanName(match[1])
    const email = normalizeEmail(match[2])
    if (!email || seen.has(email)) continue
    seen.add(email)
    contacts.push({ name, email })
  }

  BARE_EMAIL_RE.lastIndex = 0
  while ((match = BARE_EMAIL_RE.exec(field)) !== null) {
    const email = normalizeEmail(match[0])
    if (!email || seen.has(email)) continue
    seen.add(email)
    contacts.push({ name: '', email })
  }

  return contacts
}

export function parseAddressFields(fields: Array<string | null | undefined>): ContactInput[] {
  const merged = new Map<string, ContactInput>()
  for (const field of fields) {
    for (const contact of parseAddressList(field)) {
      const existing = merged.get(contact.email)
      if (!existing || (!existing.name && contact.name)) {
        merged.set(contact.email, contact)
      }
    }
  }
  return [...merged.values()]
}

export async function upsertContacts(inputs: ContactInput[]) {
  const now = new Date()
  const normalized = new Map<
    string,
    Required<Pick<ContactInput, 'name' | 'email' | 'source' | 'useCount'>> &
      Pick<ContactInput, 'lastUsedAt'>
  >()

  for (const input of inputs) {
    const email = normalizeEmail(input.email)
    if (!email) continue
    const existing = normalized.get(email)
    const name = cleanName(input.name)
    const useCount = Math.max(0, input.useCount ?? 1)
    const lastUsedAt = input.lastUsedAt ?? (useCount > 0 ? now : null)
    normalized.set(email, {
      email,
      name: name || existing?.name || '',
      source: existing?.source === 'manual' ? 'manual' : (input.source ?? 'auto'),
      useCount: (existing?.useCount ?? 0) + useCount,
      lastUsedAt:
        existing?.lastUsedAt && lastUsedAt
          ? existing.lastUsedAt > lastUsedAt
            ? existing.lastUsedAt
            : lastUsedAt
          : (existing?.lastUsedAt ?? lastUsedAt)
    })
  }

  const contacts = [...normalized.values()]
  for (let index = 0; index < contacts.length; index += 200) {
    const batch = contacts.slice(index, index + 200)
    if (batch.length === 0) continue

    await db
      .insert(mailContact)
      .values(
        batch.map((contact) => ({
          email: contact.email,
          name: contact.name,
          source: contact.source,
          useCount: contact.useCount,
          lastUsedAt: contact.lastUsedAt
        }))
      )
      .onConflictDoUpdate({
        target: mailContact.email,
        set: {
          name: sql`case when excluded.name <> '' then excluded.name else ${mailContact.name} end`,
          source: sql`case when ${mailContact.source} = 'manual' then ${mailContact.source} else excluded.source end`,
          useCount: sql`${mailContact.useCount} + excluded.use_count`,
          lastUsedAt: sql`case
            when ${mailContact.lastUsedAt} is null then excluded.last_used_at
            when excluded.last_used_at is null then ${mailContact.lastUsedAt}
            when ${mailContact.lastUsedAt} < excluded.last_used_at then excluded.last_used_at
            else ${mailContact.lastUsedAt}
          end`,
          updatedAt: now
        }
      })
  }
}

function serializeContact(contact: ContactRow): ContactSuggestion {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    display: contactDisplay(contact),
    source: contact.source,
    useCount: contact.useCount,
    lastUsedAt: contact.lastUsedAt?.toISOString() ?? null,
    updatedAt: contact.updatedAt.toISOString()
  }
}

export async function listContacts(query = '', limit = 50) {
  const q = query.trim()
  const where = q
    ? or(ilike(mailContact.email, `%${q}%`), ilike(mailContact.name, `%${q}%`))
    : undefined

  const rows = await db
    .select()
    .from(mailContact)
    .where(where)
    .orderBy(desc(mailContact.useCount), desc(mailContact.lastUsedAt), mailContact.email)
    .limit(limit)

  return rows.map(serializeContact)
}

export async function importContactsFromMessages(limit = 5000) {
  const rows = await db
    .select({
      from: mailMessage.from,
      to: mailMessage.to,
      cc: mailMessage.cc,
      replyTo: mailMessage.replyTo,
      receivedAt: mailMessage.receivedAt
    })
    .from(mailMessage)
    .orderBy(desc(mailMessage.receivedAt))
    .limit(limit)

  const contacts = rows.flatMap((row) =>
    parseAddressFields([row.from, row.to, row.cc, row.replyTo]).map((contact) => ({
      ...contact,
      source: 'auto' as const,
      useCount: 1,
      lastUsedAt: row.receivedAt ?? null
    }))
  )

  await upsertContacts(contacts)
  return contacts.length
}

export async function deleteContact(id: number) {
  await db.delete(mailContact).where(eq(mailContact.id, id))
}

export async function findContactByEmail(email: string) {
  const [contact] = await db
    .select()
    .from(mailContact)
    .where(eq(mailContact.email, normalizeEmail(email)))
    .limit(1)
  return contact ? serializeContact(contact) : null
}
