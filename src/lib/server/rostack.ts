import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  max,
  min,
  not,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { env } from '$env/dynamic/private'
import { db } from './db'
import { mailMessage, mailMessageMailbox, rostackEvent, rostackSnapshotPage } from './db/schema'
import { getExternalMessage } from './external-mail'
import { ROSTACK_API_VERSION, ROSTACK_MAX_PAGE_SIZE, ROSTACK_RESOURCE } from './rostack-constants'
import { RostackError, type RostackProblemCode } from './rostack-error'
import { concreteResourceDiscovery } from './rostack-resources'

export {
  ROSTACK_API_VERSION,
  ROSTACK_MAX_PAGE_SIZE,
  ROSTACK_RESOURCE,
  RostackError,
  type RostackProblemCode
}
const SNAPSHOT_TTL_MS = 15 * 60 * 1000
const CURSOR_SECRET = `${String(env.MAIL_SECRET_KEY)}:${String(env.BETTER_AUTH_SECRET)}`

type Filter = Record<string, unknown>

function origin(_url: URL) {
  const value = String(env.ORIGIN).replace(/\/$/, '')
  if (!value.startsWith('https://')) throw new Error('rostack requires an HTTPS ORIGIN')
  return value
}

export function mailboxEntrySchemaUrl(url: URL) {
  return `${origin(url)}/api/rostack/v1/schemas/mailbox-entry`
}

export function mailboxEntryEventSchemaUrl(url: URL) {
  return `${origin(url)}/api/rostack/v1/schemas/mailbox-entry-event`
}

export function discoveryDocument(url: URL) {
  const base = origin(url)
  return {
    protocol: { name: 'rostack', version: 'rostack_v1' },
    implementation: {
      id: 'pmh-mail',
      name: 'mail',
      api_version: ROSTACK_API_VERSION,
      documentation_url: `${base}/api-docs`
    },
    endpoints: {
      discovery: `${base}/.well-known/rostack`,
      json_api: `${base}/api/rostack/v1`,
      websocket: `${base.replace(/^http/, 'ws')}/api/rostack/v1/events`
    },
    authentication: {
      discovery_public: true,
      methods: [
        {
          type: 'shared_token',
          http_authorization_scheme: 'Rostack-Token',
          provisioning: 'out_of_band',
          description: 'Create an API key in Settings > API Keys.'
        }
      ],
      permissions: {
        'mailbox-entries:read': 'Read synchronized mailbox entries',
        'mailbox-entries:subscribe': 'Subscribe to synchronized mailbox entry events',
        'messages:read': 'Read canonical synchronized messages',
        'threads:read': 'Read synchronized message threads',
        'mailboxes:read': 'Read synchronized mailbox metadata',
        'contacts:read': 'Read saved and learned contacts',
        'attachments:read': 'Read attachment metadata',
        'send-jobs:read': 'Read outbound delivery status'
      }
    },
    capabilities: {
      filter_operators: ['eq', 'in', 'contains'],
      max_page_size: ROSTACK_MAX_PAGE_SIZE,
      websocket: {
        event_encodings: ['json', 'compact-json'],
        extensions: [],
        authentication_timeout_ms: 10000,
        heartbeat_interval_ms: 30000,
        heartbeat_timeout_ms: 10000,
        reconnect_min_delay_ms: 500,
        reconnect_max_delay_ms: 30000,
        discovery_refresh_after_ms: 300000
      }
    },
    errors: {
      http: [
        { type: 'https://spec.pmh.codes/problems/invalid-request', operations: ['list', 'get'] },
        { type: 'https://spec.pmh.codes/problems/invalid-filter', operations: ['list'] },
        { type: 'https://spec.pmh.codes/problems/unsupported-filter', operations: ['list'] },
        { type: 'https://spec.pmh.codes/problems/invalid-sort', operations: ['list'] },
        { type: 'https://spec.pmh.codes/problems/invalid-fields', operations: ['list', 'get'] },
        { type: 'https://spec.pmh.codes/problems/invalid-cursor', operations: ['list'] },
        {
          type: 'https://spec.pmh.codes/problems/authentication-required',
          operations: ['list', 'get']
        },
        { type: 'https://spec.pmh.codes/problems/resource-not-found', operations: ['get'] },
        { type: 'https://spec.pmh.codes/problems/method-not-allowed', operations: ['list', 'get'] },
        {
          type: 'https://spec.pmh.codes/problems/representation-not-acceptable',
          operations: ['list', 'get']
        },
        { type: 'https://spec.pmh.codes/problems/rate-limited', operations: ['list', 'get'] },
        {
          type: 'https://spec.pmh.codes/problems/internal-error',
          operations: ['discovery', 'list', 'get']
        },
        { type: 'https://spec.pmh.codes/problems/service-unavailable', operations: ['list', 'get'] }
      ],
      websocket: [
        {
          code: 'invalid_message',
          operations: ['authenticate', 'subscribe', 'subscription', 'session']
        },
        { code: 'authentication_failed', operations: ['authenticate'] },
        { code: 'reauthentication_identity_mismatch', operations: ['authenticate'] },
        { code: 'resource_not_found', operations: ['subscribe'] },
        { code: 'unsupported_event_type', operations: ['subscribe'] },
        { code: 'unsupported_filter', operations: ['subscribe'] },
        { code: 'unsupported_encoding', operations: ['subscribe'] },
        { code: 'subscription_id_conflict', operations: ['subscribe'] },
        { code: 'cursor_scope_mismatch', operations: ['subscribe'] },
        { code: 'cursor_unavailable', operations: ['subscribe', 'subscription'] },
        {
          code: 'internal_error',
          operations: ['authenticate', 'subscribe', 'subscription', 'session']
        },
        {
          code: 'service_unavailable',
          operations: ['authenticate', 'subscribe', 'subscription', 'session']
        }
      ]
    },
    resources: [
      {
        name: ROSTACK_RESOURCE,
        description: 'Messages as they appear in synchronized IMAP mailboxes.',
        collection_url: `${base}/api/rostack/v1/mailbox-entries`,
        item_url_template: `${base}/api/rostack/v1/mailbox-entries/{id}`,
        representations: [
          {
            media_type: 'application/json',
            schema_url: mailboxEntrySchemaUrl(url),
            schema_dialect: 'https://json-schema.org/draft/2020-12/schema'
          }
        ],
        events: ['created', 'updated', 'deleted'].map((transition) => ({
          name: `mailbox-entry.${transition}`,
          schema_url: mailboxEntryEventSchemaUrl(url),
          schema_dialect: 'https://json-schema.org/draft/2020-12/schema',
          state_transition:
            transition === 'created' ? 'create' : transition === 'updated' ? 'update' : 'delete',
          tombstone: false
        })),
        event_filtering: false,
        filtering: {
          filterable_fields: {
            '/id': ['eq', 'in'],
            '/mailbox': ['eq', 'in'],
            '/messageId': ['eq', 'in'],
            '/flags': ['contains']
          },
          sortable_fields: ['/id', '/receivedAt']
        },
        read_permissions: ['mailbox-entries:read'],
        subscribe_permissions: ['mailbox-entries:subscribe']
      },
      ...concreteResourceDiscovery(base)
    ]
  }
}

export const mailboxEntrySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'messageId',
    'mailbox',
    'uid',
    'subject',
    'from',
    'to',
    'cc',
    'preview',
    'flags',
    'receivedAt',
    'snoozedUntil',
    'threadId'
  ],
  properties: {
    id: { type: 'integer', minimum: 1 },
    messageId: { type: 'string' },
    mailbox: { type: 'string' },
    uid: { type: 'integer', minimum: 0 },
    subject: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    cc: { type: 'string' },
    preview: { type: 'string' },
    flags: { type: 'array', items: { type: 'string' } },
    receivedAt: { type: ['string', 'null'], format: 'date-time' },
    snoozedUntil: { type: ['string', 'null'], format: 'date-time' },
    threadId: { type: ['string', 'null'] }
  }
} as const

export const mailboxEntryEventSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'null'
} as const

export function schemaWithId<T extends Record<string, unknown>>(schema: T, id: string) {
  return { ...schema, $id: id }
}

export function rostackPrincipalId(userId: string) {
  return createHmac('sha256', CURSOR_SECRET).update(`principal:${userId}`).digest('base64url')
}

function parseFilter(value: string | null): Filter | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length === 0
    )
      throw new Error()
    return parsed as Filter
  } catch {
    throw new RostackError(400, 'invalid-filter', 'filter must be a valid JSON object')
  }
}

function filterConditions(filter: Filter | null): SQL[] {
  if (!filter) return []
  const conditions = []
  const columns = {
    '/id': mailMessageMailbox.id,
    '/mailbox': mailMessageMailbox.mailbox,
    '/messageId': mailMessageMailbox.messageId
  } as const
  for (const [field, rawPredicate] of Object.entries(filter)) {
    if (field === '$and' || field === '$or') {
      if (!Array.isArray(rawPredicate) || rawPredicate.length === 0)
        throw new RostackError(400, 'invalid-filter', `${field} must be a non-empty array`)
      const nested = rawPredicate.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new RostackError(400, 'invalid-filter', `${field} members must be objects`)
        const child = filterConditions(value as Filter)
        return child.length === 1 ? child[0] : and(...child)!
      })
      conditions.push((field === '$and' ? and(...nested) : or(...nested))!)
      continue
    }
    if (field === '$not') {
      if (!rawPredicate || typeof rawPredicate !== 'object' || Array.isArray(rawPredicate))
        throw new RostackError(400, 'invalid-filter', '$not must be an object')
      const child = filterConditions(rawPredicate as Filter)
      conditions.push(not(child.length === 1 ? child[0] : and(...child)!))
      continue
    }
    if (!rawPredicate || typeof rawPredicate !== 'object' || Array.isArray(rawPredicate))
      throw new RostackError(400, 'invalid-filter', 'Field predicates must be objects')
    const predicate = rawPredicate as Record<string, unknown>
    if (field === '/flags') {
      if (
        typeof predicate.contains !== 'string' ||
        Object.keys(predicate).some((key) => key !== 'contains')
      )
        throw new RostackError(
          400,
          'unsupported-filter',
          'flags supports only contains with a string'
        )
      conditions.push(sql`${mailMessageMailbox.flags}::jsonb ? ${predicate.contains}`)
      continue
    }
    const column = columns[field as keyof typeof columns]
    if (!column)
      throw new RostackError(400, 'unsupported-filter', `Unsupported filter field: ${field}`)
    if (Object.keys(predicate).length === 0)
      throw new RostackError(400, 'invalid-filter', 'Field predicates must not be empty')
    for (const [operator, operand] of Object.entries(predicate)) {
      const validScalar =
        field === '/id'
          ? typeof operand === 'number' && Number.isInteger(operand) && operand >= 1
          : typeof operand === 'string'
      if (operator === 'eq' && validScalar) conditions.push(eq(column, operand as never))
      else if (operator === 'in' && Array.isArray(operand)) {
        const validItems = operand.every((item) =>
          field === '/id'
            ? typeof item === 'number' && Number.isInteger(item) && item >= 1
            : typeof item === 'string'
        )
        if (!validItems)
          throw new RostackError(400, 'invalid-filter', `Invalid operand type for ${field}`)
        conditions.push(operand.length === 0 ? sql`false` : inArray(column, operand as never[]))
      } else if (operator === 'eq')
        throw new RostackError(400, 'invalid-filter', `Invalid operand type for ${field}`)
      else throw new RostackError(400, 'unsupported-filter', `Unsupported operator for ${field}`)
    }
  }
  return conditions
}

function projection(value: string | null) {
  if (!value) return null
  const fields = value.split(',')
  const allowed = new Set(Object.keys(mailboxEntrySchema.properties).map((field) => `/${field}`))
  if (fields.some((field) => !allowed.has(field)))
    throw new RostackError(400, 'invalid-fields', 'fields contains an unsupported JSON Pointer')
  return fields.map((field) => field.slice(1))
}

function project(item: Record<string, unknown>, fields: string[] | null) {
  return fields ? Object.fromEntries(fields.map((field) => [field, item[field]])) : item
}

function queryIdentity(url: URL) {
  return ['filter', 'sort', 'fields', 'limit']
    .map((key) => `${key}=${url.searchParams.get(key) ?? ''}`)
    .join('&')
}

function signCursor(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', CURSOR_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function readCursor(value: string, principalId: string) {
  try {
    const [encoded, signature] = value.split('.')
    const expected = createHmac('sha256', CURSOR_SECRET).update(encoded).digest()
    const actual = Buffer.from(signature, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error()
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Record<
      string,
      unknown
    >
    if (
      payload.implementation !== 'pmh-mail' ||
      payload.api !== ROSTACK_API_VERSION ||
      payload.resource !== ROSTACK_RESOURCE ||
      payload.principal !== principalId
    )
      throw new RostackError(
        400,
        'cursor_scope_mismatch',
        'Cursor does not belong to this API, resource, or principal'
      )
    return payload
  } catch (error) {
    if (error instanceof RostackError) throw error
    throw new RostackError(400, 'cursor_unavailable', 'Cursor is invalid or unavailable')
  }
}

function eventCursor(position: number, principalId: string) {
  return signCursor({
    implementation: 'pmh-mail',
    api: ROSTACK_API_VERSION,
    resource: ROSTACK_RESOURCE,
    principal: principalId,
    position
  })
}

const entrySelect = {
  id: mailMessageMailbox.id,
  messageId: mailMessageMailbox.messageId,
  mailbox: mailMessageMailbox.mailbox,
  uid: mailMessageMailbox.uid,
  subject: mailMessage.subject,
  from: mailMessage.from,
  to: mailMessage.to,
  cc: mailMessage.cc,
  preview: mailMessage.preview,
  flags: mailMessageMailbox.flags,
  receivedAt: mailMessageMailbox.receivedAt,
  snoozedUntil: mailMessageMailbox.snoozedUntil,
  threadId: mailMessage.threadId
}

function serializeEntry(
  row: typeof entrySelect extends Record<string, infer T> ? Record<string, unknown> : never
) {
  return {
    ...row,
    flags: JSON.parse(String(row.flags)) as string[],
    receivedAt: row.receivedAt instanceof Date ? row.receivedAt.toISOString() : null,
    snoozedUntil: row.snoozedUntil instanceof Date ? row.snoozedUntil.toISOString() : null
  }
}

export async function listRostackEntries(url: URL, principalId: string) {
  const cursor = url.searchParams.get('cursor')
  const identity = queryIdentity(url)
  const scopedIdentity = `${principalId}\n${identity}`
  if (cursor) {
    const [page] = await db
      .select()
      .from(rostackSnapshotPage)
      .where(eq(rostackSnapshotPage.cursor, cursor))
      .limit(1)
    if (!page || page.expiresAt <= new Date() || page.query !== scopedIdentity)
      throw new RostackError(400, 'invalid-cursor', 'Collection cursor is invalid or expired')
    return {
      items: page.items,
      page: {
        next_cursor: page.nextCursor,
        has_more: page.nextCursor !== null,
        event_cursor: page.eventCursor
      }
    }
  }

  const limitValue = Number(url.searchParams.get('limit') ?? 50)
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > ROSTACK_MAX_PAGE_SIZE)
    throw new RostackError(
      400,
      'invalid-request',
      `limit must be between 1 and ${ROSTACK_MAX_PAGE_SIZE}`
    )
  const fields = projection(url.searchParams.get('fields'))
  const conditions = filterConditions(parseFilter(url.searchParams.get('filter')))
  const sort = url.searchParams.get('sort') ?? '-/receivedAt'
  const sortFields = sort.split(',')
  if (
    sortFields.length === 0 ||
    sortFields.some((field) => !['/id', '-/id', '/receivedAt', '-/receivedAt'].includes(field))
  )
    throw new RostackError(
      400,
      'invalid-sort',
      'sort must be /id, -/id, /receivedAt, or -/receivedAt'
    )
  const order = sortFields.map((field) => {
    const column = field.includes('receivedAt')
      ? mailMessageMailbox.receivedAt
      : mailMessageMailbox.id
    return field.startsWith('-') ? desc(column) : asc(column)
  })

  return db.transaction(
    async (tx) => {
      const [boundary] = await tx
        .select({ value: max(rostackEvent.cursor) })
        .from(rostackEvent)
        .where(eq(rostackEvent.resource, ROSTACK_RESOURCE))
      const rows = await tx
        .select(entrySelect)
        .from(mailMessageMailbox)
        .innerJoin(mailMessage, eq(mailMessageMailbox.mailMessageId, mailMessage.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(...order, asc(mailMessageMailbox.id))
      const items = rows.map((row) => project(serializeEntry(row as never), fields))
      const boundaryCursor = eventCursor(Number(boundary?.value ?? 0), principalId)
      const pages = []
      for (let offset = 0; offset < items.length; offset += limitValue)
        pages.push(items.slice(offset, offset + limitValue))
      if (pages.length === 0) pages.push([])
      const cursors = pages.map(() => randomUUID())
      const expiresAt = new Date(Date.now() + SNAPSHOT_TTL_MS)
      if (pages.length > 1) {
        await tx.insert(rostackSnapshotPage).values(
          pages.slice(1).map((page, index) => ({
            cursor: cursors[index + 1],
            query: scopedIdentity,
            items: page,
            nextCursor: cursors[index + 2] ?? null,
            eventCursor: boundaryCursor,
            expiresAt
          }))
        )
      }
      return {
        items: pages[0],
        page: {
          next_cursor: cursors[1] ?? null,
          has_more: pages.length > 1,
          event_cursor: boundaryCursor
        }
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read write' }
  )
}

export async function getRostackEntry(id: string, fieldsValue: string | null) {
  if (!/^\d+$/.test(id) || Number(id) < 1)
    throw new RostackError(400, 'invalid-request', 'Invalid mailbox entry ID')
  const message = await getExternalMessage(id)
  const item = {
    id: message.id,
    messageId: message.messageId,
    mailbox: message.mailbox,
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    preview: message.preview,
    flags: message.flags,
    receivedAt: message.receivedAt,
    snoozedUntil: message.snoozedUntil,
    threadId: message.threadId
  }
  return project(item, projection(fieldsValue))
}

export async function listRostackEvents(cursor: string, principalId: string) {
  const payload = readCursor(cursor, principalId)
  const position = Number(payload.position)
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RostackError(400, 'cursor_unavailable', 'Cursor position is invalid')
  const [range] = await db
    .select({ first: min(rostackEvent.cursor), latest: max(rostackEvent.cursor) })
    .from(rostackEvent)
    .where(eq(rostackEvent.resource, ROSTACK_RESOURCE))
  const first = Number(range?.first ?? 0)
  const latest = Number(range?.latest ?? 0)
  if (first > 0 && position < first - 1)
    throw new RostackError(400, 'cursor_unavailable', 'Cursor is older than retained event history')
  if (position > latest)
    throw new RostackError(400, 'cursor_unavailable', 'Cursor is ahead of the event stream')
  const rows = await db
    .select()
    .from(rostackEvent)
    .where(and(eq(rostackEvent.resource, ROSTACK_RESOURCE), gt(rostackEvent.cursor, position)))
    .orderBy(asc(rostackEvent.cursor))
    .limit(100)
  return rows.map((row) => ({
    event_id: row.eventId,
    cursor: eventCursor(row.cursor, principalId),
    occurred_at: row.occurredAt.toISOString(),
    event_type: row.eventType,
    resource_id: row.resourceId,
    resource_version: row.resourceVersion
  }))
}

export async function currentRostackCursor(principalId: string) {
  const [row] = await db
    .select({ value: max(rostackEvent.cursor) })
    .from(rostackEvent)
    .where(eq(rostackEvent.resource, ROSTACK_RESOURCE))
  return eventCursor(Number(row?.value ?? 0), principalId)
}

export async function cleanupRostackState() {
  await db.delete(rostackSnapshotPage).where(lte(rostackSnapshotPage.expiresAt, new Date()))
  await db
    .delete(rostackEvent)
    .where(
      and(
        lte(rostackEvent.occurredAt, sql`now() - interval '7 days'`),
        lt(
          rostackEvent.cursor,
          sql`(select max(retained.cursor) from rostack_event retained where retained.resource = ${rostackEvent.resource})`
        )
      )
    )
}
