import { db } from '$lib/server/db'
import {
  mailContact,
  mailContactGroup,
  mailContactGroupMember,
  mailMessage,
  mailMessageMailbox
} from '$lib/server/db/schema'
import { asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'

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

export type ContactMessage = {
  id: number
  messageId: string
  mailbox: string
  uid: number
  flags: string[]
  subject: string
  from: string
  to: string
  cc: string
  preview: string
  receivedAt: string | null
  threadId: string | null
}

export type ContactGroupSuggestion = {
  id: number
  name: string
  description: string
  display: string
  members: ContactSuggestion[]
  updatedAt: string
}

const EMAIL_RE = /([^<,;]*?)\s*<([^>]+)>/g
const BARE_EMAIL_RE = /[\w.+%-]+@[\w.-]+\.[a-z]{2,}/gi
const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CSV_HEADERS = ['name', 'email'] as const

export type ContactCsvPreviewRow = {
  row: number
  name: string
  email: string
  status: 'valid' | 'duplicate' | 'invalid'
  error: string | null
}

export type ContactCsvPreview = {
  rows: ContactCsvPreviewRow[]
  validCount: number
  duplicateCount: number
  invalidCount: number
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function cleanName(name: string) {
  return name.trim().replace(/^["']|["']$/g, '')
}

function csvEscape(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? '' : String(value)
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }

  cells.push(cell.trim())
  return cells
}

function parseCsvRows(csv: string) {
  const rows: string[][] = []
  let line = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const next = csv[index + 1]
    if (char === '"') {
      if (quoted && next === '"') {
        line += char + next
        index += 1
      } else {
        quoted = !quoted
        line += char
      }
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      if (line.trim()) rows.push(parseCsvLine(line))
      line = ''
    } else {
      line += char
    }
  }

  if (line.trim()) rows.push(parseCsvLine(line))
  return rows
}

function headerIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header.trim().toLowerCase()))
}

export function validateEmail(email: string) {
  return VALID_EMAIL_RE.test(normalizeEmail(email))
}

export function previewContactCsv(csv: string): ContactCsvPreview {
  const parsedRows = parseCsvRows(csv)
  if (parsedRows.length === 0) {
    return { rows: [], validCount: 0, duplicateCount: 0, invalidCount: 0 }
  }

  const headers = parsedRows[0].map((cell) => cell.trim().toLowerCase())
  const emailIndex = headerIndex(headers, ['email', 'e-mail', 'email address'])
  const nameIndex = headerIndex(headers, ['name', 'display name', 'full name'])
  const seen = new Set<string>()
  const rows: ContactCsvPreviewRow[] = []

  if (emailIndex === -1) {
    return {
      rows: [
        {
          row: 1,
          name: '',
          email: '',
          status: 'invalid',
          error: 'CSV must include an email header.'
        }
      ],
      validCount: 0,
      duplicateCount: 0,
      invalidCount: 1
    }
  }

  for (let index = 1; index < parsedRows.length; index += 1) {
    const row = parsedRows[index]
    const email = normalizeEmail(row[emailIndex] ?? '')
    const name = cleanName(nameIndex === -1 ? '' : (row[nameIndex] ?? ''))
    let status: ContactCsvPreviewRow['status'] = 'valid'
    let error: string | null = null

    if (!email) {
      status = 'invalid'
      error = 'Email is required.'
    } else if (!validateEmail(email)) {
      status = 'invalid'
      error = 'Email is invalid.'
    } else if (seen.has(email)) {
      status = 'duplicate'
      error = 'Duplicate email in CSV.'
    } else {
      seen.add(email)
    }

    rows.push({ row: index + 1, name, email, status, error })
  }

  return {
    rows,
    validCount: rows.filter((row) => row.status === 'valid').length,
    duplicateCount: rows.filter((row) => row.status === 'duplicate').length,
    invalidCount: rows.filter((row) => row.status === 'invalid').length
  }
}

export function contactCsvInputs(csv: string): ContactInput[] {
  return previewContactCsv(csv)
    .rows.filter((row) => row.status === 'valid')
    .map((row) => ({
      name: row.name,
      email: row.email,
      source: 'manual',
      useCount: 0,
      lastUsedAt: null
    }))
}

export function serializeContactsCsv(contacts: Array<Pick<ContactSuggestion, 'name' | 'email'>>) {
  return [
    CSV_HEADERS.join(','),
    ...contacts.map((contact) => CSV_HEADERS.map((key) => csvEscape(contact[key])).join(','))
  ].join('\n')
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

export async function getContactById(id: number) {
  const [contact] = await db.select().from(mailContact).where(eq(mailContact.id, id)).limit(1)
  return contact ? serializeContact(contact) : null
}

export async function listMessagesForContact(email: string, limit = 20) {
  const q = `%${normalizeEmail(email)}%`
  const rows = await db
    .select({
      id: mailMessageMailbox.id,
      messageId: mailMessage.messageId,
      mailbox: mailMessageMailbox.mailbox,
      uid: mailMessageMailbox.uid,
      flags: mailMessageMailbox.flags,
      subject: mailMessage.subject,
      from: mailMessage.from,
      to: mailMessage.to,
      cc: mailMessage.cc,
      replyTo: mailMessage.replyTo,
      preview: mailMessage.preview,
      receivedAt: mailMessage.receivedAt,
      threadId: mailMessage.threadKey
    })
    .from(mailMessage)
    .innerJoin(mailMessageMailbox, eq(mailMessageMailbox.messageId, mailMessage.messageId))
    .where(
      or(
        ilike(mailMessage.from, q),
        ilike(mailMessage.to, q),
        ilike(mailMessage.cc, q),
        ilike(mailMessage.replyTo, q)
      )
    )
    .orderBy(desc(mailMessage.receivedAt), desc(mailMessageMailbox.uid))
    .limit(limit * 3)

  const seen = new Set<string>()
  const messages: ContactMessage[] = []
  for (const row of rows) {
    if (seen.has(row.messageId)) continue
    seen.add(row.messageId)
    messages.push({
      id: row.id,
      messageId: row.messageId,
      mailbox: row.mailbox,
      uid: row.uid,
      flags: JSON.parse(row.flags) as string[],
      subject: row.subject,
      from: row.from,
      to: row.to,
      cc: row.cc,
      preview: row.preview,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      threadId: row.threadId
    })
    if (messages.length >= limit) break
  }

  return messages
}

function serializeGroup(
  group: typeof mailContactGroup.$inferSelect,
  members: ContactSuggestion[]
): ContactGroupSuggestion {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    display: `${group.name} (${members.length})`,
    members,
    updatedAt: group.updatedAt.toISOString()
  }
}

export async function listContactGroups(query = '', limit = 50) {
  const q = query.trim()
  const where = q
    ? or(ilike(mailContactGroup.name, `%${q}%`), ilike(mailContactGroup.description, `%${q}%`))
    : undefined
  const groups = await db
    .select()
    .from(mailContactGroup)
    .where(where)
    .orderBy(asc(mailContactGroup.name))
    .limit(limit)

  if (groups.length === 0) return []

  const rows = await db
    .select({ groupId: mailContactGroupMember.groupId, contact: mailContact })
    .from(mailContactGroupMember)
    .innerJoin(mailContact, eq(mailContactGroupMember.contactId, mailContact.id))
    .where(
      inArray(
        mailContactGroupMember.groupId,
        groups.map((group) => group.id)
      )
    )
    .orderBy(mailContactGroupMember.groupId, asc(mailContact.name), asc(mailContact.email))

  const membersByGroup = new Map<number, ContactSuggestion[]>()
  for (const row of rows) {
    const members = membersByGroup.get(row.groupId) ?? []
    members.push(serializeContact(row.contact))
    membersByGroup.set(row.groupId, members)
  }

  return groups.map((group) => serializeGroup(group, membersByGroup.get(group.id) ?? []))
}

export async function saveContactGroup(input: {
  id?: number | null
  name: string
  description?: string
  contactIds: number[]
}) {
  const name = input.name.trim()
  const now = new Date()
  const contactIds = [...new Set(input.contactIds.filter((id) => Number.isFinite(id) && id > 0))]

  const [group] = input.id
    ? await db
        .update(mailContactGroup)
        .set({ name, description: input.description?.trim() ?? '', updatedAt: now })
        .where(eq(mailContactGroup.id, input.id))
        .returning()
    : await db
        .insert(mailContactGroup)
        .values({ name, description: input.description?.trim() ?? '' })
        .returning()

  if (!group) return null

  await db.delete(mailContactGroupMember).where(eq(mailContactGroupMember.groupId, group.id))
  if (contactIds.length > 0) {
    await db
      .insert(mailContactGroupMember)
      .values(contactIds.map((contactId) => ({ groupId: group.id, contactId })))
      .onConflictDoNothing()
  }

  const [saved] = await listContactGroups(group.name, 1)
  return saved ?? serializeGroup(group, [])
}

export async function deleteContactGroup(id: number) {
  await db.delete(mailContactGroupMember).where(eq(mailContactGroupMember.groupId, id))
  await db.delete(mailContactGroup).where(eq(mailContactGroup.id, id))
}

export async function listContactsForExport() {
  const rows = await db.select().from(mailContact).orderBy(asc(mailContact.email))
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
  await db.delete(mailContactGroupMember).where(eq(mailContactGroupMember.contactId, id))
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
