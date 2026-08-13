import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { db } from './db'
import {
  mailAttachment,
  mailContact,
  mailboxCatalog,
  mailMessage,
  mailThreadSummary,
  rostackSnapshotPage,
  smtpJob
} from './db/schema'
import { RostackError } from './rostack-error'
import { ROSTACK_MAX_PAGE_SIZE } from './rostack-constants'

const SNAPSHOT_TTL_MS = 15 * 60 * 1000
const schemaBase = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false
} as const
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const

const resourceSchemas = {
  messages: {
    ...schemaBase,
    required: [
      'id',
      'messageId',
      'subject',
      'from',
      'to',
      'cc',
      'replyTo',
      'preview',
      'textContent',
      'htmlContent',
      'inReplyTo',
      'references',
      'threadId',
      'receivedAt'
    ],
    properties: {
      id: { type: 'integer', minimum: 1 },
      messageId: { type: 'string' },
      subject: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      cc: { type: 'string' },
      replyTo: { type: ['string', 'null'] },
      preview: { type: 'string' },
      textContent: { type: 'string' },
      htmlContent: { type: ['string', 'null'] },
      inReplyTo: { type: ['string', 'null'] },
      references: { type: ['string', 'null'] },
      threadId: { type: 'string' },
      receivedAt: nullableDate
    }
  },
  threads: {
    ...schemaBase,
    required: ['id', 'mailbox', 'threadId', 'messageCount', 'latestReceivedAt'],
    properties: {
      id: { type: 'string' },
      mailbox: { type: 'string' },
      threadId: { type: 'string' },
      messageCount: { type: 'integer', minimum: 1 },
      latestReceivedAt: nullableDate
    }
  },
  mailboxes: {
    ...schemaBase,
    required: ['id', 'name', 'delimiter', 'specialUse', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      delimiter: { type: 'string' },
      specialUse: { type: ['string', 'null'] },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  },
  contacts: {
    ...schemaBase,
    required: ['id', 'email', 'name', 'source', 'useCount', 'lastUsedAt', 'updatedAt'],
    properties: {
      id: { type: 'integer', minimum: 1 },
      email: { type: 'string' },
      name: { type: 'string' },
      source: { type: 'string' },
      useCount: { type: 'integer', minimum: 0 },
      lastUsedAt: nullableDate,
      updatedAt: { type: 'string', format: 'date-time' }
    }
  },
  attachments: {
    ...schemaBase,
    required: ['id', 'messageId', 'filename', 'contentType', 'size', 'downloadUrl'],
    properties: {
      id: { type: 'integer', minimum: 1 },
      messageId: { type: 'string' },
      filename: { type: 'string' },
      contentType: { type: 'string' },
      size: { type: 'integer', minimum: 0 },
      downloadUrl: { type: 'string' }
    }
  },
  'send-jobs': {
    ...schemaBase,
    required: [
      'id',
      'status',
      'attemptCount',
      'availableAt',
      'lastError',
      'deliveredAt',
      'messageId',
      'openedAt',
      'createdAt',
      'updatedAt'
    ],
    properties: {
      id: { type: 'integer', minimum: 1 },
      status: { type: 'string' },
      attemptCount: { type: 'integer', minimum: 0 },
      availableAt: { type: 'string', format: 'date-time' },
      lastError: { type: ['string', 'null'] },
      deliveredAt: nullableDate,
      messageId: { type: ['string', 'null'] },
      openedAt: nullableDate,
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  }
} as const

export type RostackConcreteResource = keyof typeof resourceSchemas
export const ROSTACK_CONCRETE_RESOURCES = Object.keys(resourceSchemas) as RostackConcreteResource[]

export function isRostackConcreteResource(value: string): value is RostackConcreteResource {
  return value in resourceSchemas
}

export function rostackResourceSchema(resource: RostackConcreteResource) {
  return resourceSchemas[resource]
}

export function rostackResourceSchemaUrl(base: string, resource: RostackConcreteResource) {
  return `${base}/api/rostack/v1/schemas/${resource}`
}

export function concreteResourceDiscovery(base: string) {
  return ROSTACK_CONCRETE_RESOURCES.map((name) => ({
    name,
    description: {
      messages: 'Canonical synchronized messages, independent of mailbox placement.',
      threads: 'Message threads within synchronized mailboxes.',
      mailboxes: 'Synchronized IMAP mailboxes.',
      contacts: 'Saved and learned mail contacts.',
      attachments: 'Attachment metadata and authenticated download URLs.',
      'send-jobs': 'Outbound delivery job status without message payloads.'
    }[name],
    collection_url: `${base}/api/rostack/v1/${name}`,
    item_url_template: `${base}/api/rostack/v1/${name}/{id}`,
    representations: [
      {
        media_type: 'application/json',
        schema_url: rostackResourceSchemaUrl(base, name),
        schema_dialect: 'https://json-schema.org/draft/2020-12/schema'
      }
    ],
    events: [],
    event_filtering: false,
    filtering: { filterable_fields: { '/id': ['eq', 'in'] }, sortable_fields: ['/id'] },
    read_permissions: [`${name}:read`],
    subscribe_permissions: []
  }))
}

function date(value: Date | null) {
  return value?.toISOString() ?? null
}

function threadId(mailbox: string, thread: string) {
  return Buffer.from(JSON.stringify([mailbox, thread])).toString('base64url')
}

async function readRows(resource: RostackConcreteResource): Promise<Record<string, unknown>[]> {
  switch (resource) {
    case 'messages': {
      const rows = await db
        .select({
          id: mailMessage.id,
          messageId: mailMessage.messageId,
          subject: mailMessage.subject,
          from: mailMessage.from,
          to: mailMessage.to,
          cc: mailMessage.cc,
          replyTo: mailMessage.replyTo,
          preview: mailMessage.preview,
          textContent: mailMessage.textContent,
          htmlContent: mailMessage.htmlContent,
          inReplyTo: mailMessage.inReplyTo,
          references: mailMessage.references,
          threadId: mailMessage.threadKey,
          receivedAt: mailMessage.receivedAt
        })
        .from(mailMessage)
        .orderBy(asc(mailMessage.id))
      return rows.map((row) => ({ ...row, receivedAt: date(row.receivedAt) }))
    }
    case 'threads': {
      const rows = await db.select().from(mailThreadSummary).orderBy(asc(mailThreadSummary.mailbox))
      return rows.map((row) => ({
        id: threadId(row.mailbox, row.threadKey),
        mailbox: row.mailbox,
        threadId: row.threadKey,
        messageCount: Number(row.threadCount),
        latestReceivedAt: date(row.latestReceivedAt)
      }))
    }
    case 'mailboxes': {
      const rows = await db.select().from(mailboxCatalog).orderBy(asc(mailboxCatalog.path))
      return rows.map((row) => ({
        id: row.path,
        name: row.name,
        delimiter: row.delimiter,
        specialUse: row.specialUse,
        updatedAt: row.updatedAt.toISOString()
      }))
    }
    case 'contacts': {
      const rows = await db.select().from(mailContact).orderBy(asc(mailContact.id))
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        source: row.source,
        useCount: row.useCount,
        lastUsedAt: date(row.lastUsedAt),
        updatedAt: row.updatedAt.toISOString()
      }))
    }
    case 'attachments': {
      const rows = await db
        .select({
          id: mailAttachment.id,
          messageId: mailAttachment.messageId,
          filename: mailAttachment.filename,
          contentType: mailAttachment.contentType,
          size: mailAttachment.size
        })
        .from(mailAttachment)
        .orderBy(asc(mailAttachment.id))
      return rows.map((row) => ({
        ...row,
        downloadUrl: `/api/external/v1/attachments/${row.id}`
      }))
    }
    case 'send-jobs': {
      const rows = await db
        .select({
          id: smtpJob.id,
          status: smtpJob.status,
          attemptCount: smtpJob.attemptCount,
          availableAt: smtpJob.availableAt,
          lastError: smtpJob.lastError,
          deliveredAt: smtpJob.deliveredAt,
          messageId: smtpJob.messageId,
          openedAt: smtpJob.openedAt,
          createdAt: smtpJob.createdAt,
          updatedAt: smtpJob.updatedAt
        })
        .from(smtpJob)
        .orderBy(asc(smtpJob.id))
      return rows.map((row) => ({
        ...row,
        availableAt: row.availableAt.toISOString(),
        deliveredAt: date(row.deliveredAt),
        openedAt: date(row.openedAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }))
    }
  }
}

function fields(resource: RostackConcreteResource, value: string | null) {
  if (!value) return null
  const selected = value.split(',')
  const allowed = new Set(Object.keys(resourceSchemas[resource].properties).map((key) => `/${key}`))
  if (selected.some((field) => !allowed.has(field)))
    throw new RostackError(400, 'invalid-fields', 'fields contains an unsupported JSON Pointer')
  return selected.map((field) => field.slice(1))
}

function project(item: Record<string, unknown>, selected: string[] | null) {
  return selected ? Object.fromEntries(selected.map((field) => [field, item[field]])) : item
}

function filteredRows(rows: Record<string, unknown>[], filterValue: string | null) {
  if (!filterValue) return rows
  let filter: Record<string, unknown>
  try {
    filter = JSON.parse(filterValue) as Record<string, unknown>
  } catch {
    throw new RostackError(400, 'invalid-filter', 'filter must be a valid JSON object')
  }
  if (!filter || Array.isArray(filter) || Object.keys(filter).length !== 1 || !filter['/id'])
    throw new RostackError(400, 'unsupported-filter', 'Only /id filtering is supported')
  const predicate = filter['/id'] as Record<string, unknown>
  if (predicate && Object.keys(predicate).length === 1 && 'eq' in predicate)
    return rows.filter((row) => row.id === predicate.eq)
  const includedIds = predicate?.in
  if (predicate && Object.keys(predicate).length === 1 && Array.isArray(includedIds))
    return rows.filter((row) => includedIds.includes(row.id))
  throw new RostackError(400, 'unsupported-filter', '/id supports only eq and in')
}

export async function listRostackResource(
  resource: RostackConcreteResource,
  url: URL,
  principalId: string
) {
  const cursor = url.searchParams.get('cursor')
  const query = `${principalId}\n${resource}\n${['filter', 'sort', 'fields', 'limit']
    .map((key) => `${key}=${url.searchParams.get(key) ?? ''}`)
    .join('&')}`
  if (cursor) {
    const [page] = await db
      .select()
      .from(rostackSnapshotPage)
      .where(eq(rostackSnapshotPage.cursor, cursor))
      .limit(1)
    if (!page || page.expiresAt <= new Date() || page.query !== query)
      throw new RostackError(400, 'invalid-cursor', 'Collection cursor is invalid or expired')
    return {
      items: page.items,
      page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null }
    }
  }

  const limit = Number(url.searchParams.get('limit') ?? 50)
  if (!Number.isInteger(limit) || limit < 1 || limit > ROSTACK_MAX_PAGE_SIZE)
    throw new RostackError(
      400,
      'invalid-request',
      `limit must be between 1 and ${ROSTACK_MAX_PAGE_SIZE}`
    )
  const sort = url.searchParams.get('sort') ?? '/id'
  if (sort !== '/id' && sort !== '-/id')
    throw new RostackError(400, 'invalid-sort', 'sort must be /id or -/id')
  const selected = fields(resource, url.searchParams.get('fields'))
  const rows = filteredRows(await readRows(resource), url.searchParams.get('filter'))
  if (sort === '-/id') rows.reverse()
  const items = rows.map((row) => project(row, selected))
  const pages = []
  for (let offset = 0; offset < items.length; offset += limit)
    pages.push(items.slice(offset, offset + limit))
  if (pages.length === 0) pages.push([])
  const cursors = pages.map(() => randomUUID())
  if (pages.length > 1) {
    const expiresAt = new Date(Date.now() + SNAPSHOT_TTL_MS)
    await db.insert(rostackSnapshotPage).values(
      pages.slice(1).map((page, index) => ({
        cursor: cursors[index + 1],
        query,
        items: page,
        nextCursor: cursors[index + 2] ?? null,
        eventCursor: '',
        expiresAt
      }))
    )
  }
  return {
    items: pages[0],
    page: { next_cursor: cursors[1] ?? null, has_more: pages.length > 1 }
  }
}

export async function getRostackResource(
  resource: RostackConcreteResource,
  id: string,
  fieldsValue: string | null
) {
  const decodedId = decodeURIComponent(id)
  const rows = await readRows(resource)
  const item = rows.find((row) => String(row.id) === decodedId)
  if (!item) throw new RostackError(404, 'resource-not-found', `${resource} item not found`)
  return project(item, fields(resource, fieldsValue))
}
