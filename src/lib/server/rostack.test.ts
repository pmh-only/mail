import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  pages: [] as Record<string, unknown>[],
  selected: null as Record<string, unknown>[] | null,
  deleted: 0
}))

function queryResult(value: () => unknown[]) {
  const query: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit'])
    query[method] = vi.fn(() => query)
  // Drizzle query builders are awaitable; this mock mirrors that interface.
  // oxlint-disable-next-line unicorn/no-thenable
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(value()).then(resolve)
  return query
}

const db = vi.hoisted(() => ({
  select: vi.fn((selection?: Record<string, unknown>) => {
    const keys = Object.keys(selection ?? {})
    if (keys.length === 1)
      return queryResult(() => [{ value: state.events.at(-1)?.cursor ?? null }])
    if (keys.includes('first'))
      return queryResult(() => [
        { first: state.events[0]?.cursor, latest: state.events.at(-1)?.cursor }
      ])
    return queryResult(() => state.selected ?? state.events)
  }),
  delete: vi.fn(() => ({
    where: vi.fn(async () => {
      state.deleted += 1
    })
  })),
  transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({
      select: vi.fn((selection?: Record<string, unknown>) => {
        if (Object.keys(selection ?? {}).length === 1)
          return queryResult(() => [{ value: state.events.at(-1)?.cursor ?? null }])
        return queryResult(() => state.entries)
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async (values: Record<string, unknown>[]) => state.pages.push(...values))
      }))
    })
  )
}))

const env = vi.hoisted(() => ({
  ORIGIN: 'https://mail.example',
  MAIL_SECRET_KEY: 'test-secret',
  BETTER_AUTH_SECRET: 'auth-secret'
}))
vi.mock('$env/dynamic/private', () => ({ env }))
vi.mock('./db', () => ({ db }))
vi.mock('./db/schema', () => {
  const columns = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, { name, toString: () => name }]))
  return {
    mailMessage: columns(['id', 'subject', 'from', 'to', 'cc', 'preview', 'threadId']),
    mailMessageMailbox: columns([
      'id',
      'mailMessageId',
      'messageId',
      'mailbox',
      'uid',
      'flags',
      'receivedAt',
      'snoozedUntil'
    ]),
    rostackEvent: columns([
      'cursor',
      'eventId',
      'resource',
      'eventType',
      'resourceId',
      'resourceVersion',
      'occurredAt'
    ]),
    rostackSnapshotPage: columns([
      'cursor',
      'query',
      'items',
      'nextCursor',
      'eventCursor',
      'expiresAt'
    ])
  }
})
vi.mock('./external-mail', () => ({
  getExternalMessage: vi.fn(async (id: string) => ({
    id: Number(id),
    messageId: 'message-1',
    mailbox: 'INBOX',
    uid: 4,
    subject: 'Subject',
    from: 'from@example.com',
    to: 'to@example.com',
    cc: '',
    preview: 'Preview',
    flags: ['\\Seen'],
    receivedAt: '2026-08-12T00:00:00.000Z',
    snoozedUntil: null,
    threadId: null
  }))
}))

import {
  cleanupRostackState,
  currentRostackCursor,
  discoveryDocument,
  getRostackEntry,
  listRostackEntries,
  listRostackEvents,
  mailboxEntryEventSchema,
  mailboxEntrySchema,
  mailboxEntrySchemaUrl,
  rostackPrincipalId,
  schemaWithId
} from './rostack.ts'

beforeEach(() => {
  state.entries.length = 0
  state.events.length = 0
  state.pages.length = 0
  state.selected = null
  state.deleted = 0
  vi.clearAllMocks()
})

test('advertises the shared-token mailbox entry API and schemas', () => {
  const discovery = discoveryDocument(new URL('http://ignored.example'))
  assert.equal(discovery.protocol.version, 'rostack_v1')
  assert.equal(discovery.endpoints.websocket, 'wss://mail.example/api/rostack/v1/events')
  assert.equal(discovery.authentication.methods[0].http_authorization_scheme, 'Rostack-Token')
  assert.equal(discovery.resources[0].name, 'mailbox-entries')
  assert.deepEqual(
    discovery.resources.map((resource) => resource.name),
    ['mailbox-entries', 'messages', 'threads', 'mailboxes', 'contacts', 'attachments', 'send-jobs']
  )
  assert.equal(discovery.resources[0].events.length, 3)
  assert.ok(discovery.errors.http.length > 0)
  assert.ok(discovery.errors.websocket.length > 0)
  assert.equal(mailboxEntrySchema.additionalProperties, false)
  assert.equal(mailboxEntryEventSchema.type, 'null')
  assert.equal(
    schemaWithId(mailboxEntrySchema, mailboxEntrySchemaUrl(new URL('https://mail.example'))).$id,
    discovery.resources[0].representations[0].schema_url
  )
  assert.equal(rostackPrincipalId('owner'), rostackPrincipalId('owner'))
  assert.notEqual(rostackPrincipalId('owner'), rostackPrincipalId('other'))
})

test('requires a TLS discovery origin', () => {
  const previous = env.ORIGIN
  env.ORIGIN = 'http://mail.example'
  assert.throws(() => discoveryDocument(new URL('http://mail.example')), /HTTPS ORIGIN/)
  env.ORIGIN = previous
})

test('returns and projects a mailbox entry item', async () => {
  assert.deepEqual(await getRostackEntry('4', '/id,/subject'), { id: 4, subject: 'Subject' })
  await assert.rejects(getRostackEntry('bad', null), { code: 'invalid-request' })
  await assert.rejects(getRostackEntry('4', '/unknown'), { code: 'invalid-fields' })
})

test('creates a stable paginated collection snapshot', async () => {
  state.events.push({ cursor: 7 })
  state.entries.push(
    {
      id: 1,
      messageId: 'one',
      mailbox: 'INBOX',
      uid: 1,
      subject: 'One',
      from: '',
      to: '',
      cc: '',
      preview: '',
      flags: '[]',
      receivedAt: new Date('2026-08-12T00:00:00Z'),
      snoozedUntil: null,
      threadId: null
    },
    {
      id: 2,
      messageId: 'two',
      mailbox: 'Archive',
      uid: 2,
      subject: 'Two',
      from: '',
      to: '',
      cc: '',
      preview: '',
      flags: '[]',
      receivedAt: null,
      snoozedUntil: null,
      threadId: null
    }
  )
  const result = await listRostackEntries(
    new URL('https://mail.example/api/rostack/v1/mailbox-entries?limit=1&sort=/id'),
    'key-1'
  )
  assert.equal(result.items.length, 1)
  assert.equal(result.page.has_more, true)
  assert.match(result.page.event_cursor, /\./)
  assert.equal(state.pages.length, 1)
})

test('stores every continuation page in a longer snapshot', async () => {
  for (let id = 1; id <= 3; id += 1) {
    state.entries.push({
      id,
      messageId: String(id),
      mailbox: 'INBOX',
      uid: id,
      subject: '',
      from: '',
      to: '',
      cc: '',
      preview: '',
      flags: '[]',
      receivedAt: null,
      snoozedUntil: null,
      threadId: null
    })
  }
  const result = await listRostackEntries(
    new URL('https://mail.example/api/rostack/v1/mailbox-entries?limit=1&sort=/receivedAt'),
    'key-1'
  )
  assert.equal(result.page.has_more, true)
  assert.equal(state.pages.length, 2)
  assert.equal(typeof state.pages[0].nextCursor, 'string')
})

test('returns empty snapshots and full unprojected items', async () => {
  const empty = await listRostackEntries(
    new URL('https://mail.example/api/rostack/v1/mailbox-entries'),
    'key-1'
  )
  assert.deepEqual(empty.items, [])
  assert.equal(empty.page.has_more, false)

  state.entries.push({
    id: 1,
    messageId: 'one',
    mailbox: 'INBOX',
    uid: 1,
    subject: 'One',
    from: '',
    to: '',
    cc: '',
    preview: '',
    flags: '[]',
    receivedAt: null,
    snoozedUntil: new Date('2026-08-13T00:00:00Z'),
    threadId: null
  })
  const full = await listRostackEntries(
    new URL('https://mail.example/api/rostack/v1/mailbox-entries?sort=-/id'),
    'key-1'
  )
  assert.equal(full.items[0].snoozedUntil, '2026-08-13T00:00:00.000Z')
})

test('accepts advertised field filters and boolean composition', async () => {
  const filters = [
    { '/id': { eq: 1, in: [1, 2] } },
    { '/id': { in: [] } },
    { '/mailbox': { in: ['INBOX'] } },
    { '/messageId': { eq: 'one' } },
    { '/flags': { contains: '%_Seen' } },
    { $and: [{ '/id': { eq: 1 } }, { '/mailbox': { eq: 'INBOX' }, '/messageId': { eq: 'one' } }] },
    { $or: [{ '/id': { eq: 1 } }, { '/id': { eq: 2 } }] },
    { $not: { '/id': { eq: 4 } } },
    { $not: { '/id': { eq: 3 }, '/mailbox': { eq: 'Spam' } } }
  ]
  for (const filter of filters) {
    const url = new URL('https://mail.example/api/rostack/v1/mailbox-entries')
    url.searchParams.set('filter', JSON.stringify(filter))
    await assert.doesNotReject(listRostackEntries(url, 'key-1'))
  }
})

test('validates malformed boolean and field predicates', async () => {
  const filters = [
    { $and: [1] },
    { $or: 'wrong' },
    { $not: [] },
    { '/id': null },
    { '/id': {} },
    { '/id': { in: 'wrong' } },
    { '/id': { eq: '1' } },
    { '/mailbox': { eq: 1 } },
    { '/id': { in: ['1'] } },
    { '/flags': { contains: 'seen', eq: 'seen' } }
  ]
  for (const filter of filters) {
    const url = new URL('https://mail.example/api/rostack/v1/mailbox-entries')
    url.searchParams.set('filter', JSON.stringify(filter))
    await assert.rejects(listRostackEntries(url, 'key-1'))
  }
})

test('reads only valid scoped collection continuation pages', async () => {
  const url = new URL('https://mail.example/api/rostack/v1/mailbox-entries?cursor=page-1&limit=2')
  state.selected = [
    {
      cursor: 'page-1',
      query: 'key-1\nfilter=&sort=&fields=&limit=2',
      items: [{ id: 2 }],
      nextCursor: null,
      eventCursor: 'event-boundary',
      expiresAt: new Date(Date.now() + 60_000)
    }
  ]
  const page = await listRostackEntries(url, 'key-1')
  assert.deepEqual(page.items, [{ id: 2 }])
  assert.equal(page.page.has_more, false)

  state.selected = [
    {
      cursor: 'page-1',
      query: 'key-1\nfilter=&sort=&fields=&limit=2',
      items: [{ id: 2 }],
      nextCursor: 'page-2',
      eventCursor: 'event-boundary',
      expiresAt: new Date(Date.now() + 60_000)
    }
  ]
  assert.equal((await listRostackEntries(url, 'key-1')).page.has_more, true)

  state.selected = []
  await assert.rejects(listRostackEntries(url, 'key-1'), { code: 'invalid-cursor' })
  state.selected = [{ ...page, query: 'wrong', expiresAt: new Date(Date.now() + 60_000) }]
  await assert.rejects(listRostackEntries(url, 'key-1'), { code: 'invalid-cursor' })
  state.selected = [
    {
      cursor: 'page-1',
      query: 'key-1\nfilter=&sort=&fields=&limit=2',
      items: [],
      nextCursor: null,
      eventCursor: 'event-boundary',
      expiresAt: new Date(0)
    }
  ]
  await assert.rejects(listRostackEntries(url, 'key-1'), { code: 'invalid-cursor' })
})

test.each([
  ['?limit=0', 'invalid-request'],
  ['?limit=1.5', 'invalid-request'],
  ['?limit=101', 'invalid-request'],
  ['?sort=/subject', 'invalid-sort'],
  ['?filter=nope', 'invalid-filter'],
  ['?filter=false', 'invalid-filter'],
  ['?filter=[]', 'invalid-filter'],
  ['?filter={}', 'invalid-filter'],
  ['?filter={"$or":[]}', 'invalid-filter'],
  ['?filter={"/unknown":{"eq":1}}', 'unsupported-filter'],
  ['?filter={"/id":{"gt":1}}', 'unsupported-filter'],
  ['?filter={"/flags":{"contains":1}}', 'unsupported-filter']
])('rejects invalid collection query %s', async (search, code) => {
  await assert.rejects(
    listRostackEntries(
      new URL(`https://mail.example/api/rostack/v1/mailbox-entries${search}`),
      'key-1'
    ),
    { code }
  )
})

test('returns scoped event cursors and replay events', async () => {
  state.events.push({
    cursor: 2,
    eventId: 'event-2',
    resource: 'mailbox-entries',
    eventType: 'mailbox-entry.updated',
    resourceId: '4',
    resourceVersion: 'revision-2',
    occurredAt: new Date('2026-08-12T00:00:00Z')
  })
  const cursor = await currentRostackCursor('key-1')
  const events = await listRostackEvents(cursor, 'key-1')
  assert.equal(events[0].event_id, 'event-2')
  await assert.rejects(listRostackEvents(cursor, 'key-2'), { code: 'cursor_scope_mismatch' })
  await assert.rejects(listRostackEvents('bad', 'key-1'), { code: 'cursor_unavailable' })
})

function signedCursor(
  position: unknown,
  overrides: Partial<{ api: string; resource: string; principal: string }> = {}
) {
  const encoded = Buffer.from(
    JSON.stringify({
      implementation: 'pmh-mail',
      api: 'mail-2026-08-13-1',
      resource: 'mailbox-entries',
      principal: 'key-1',
      position,
      ...overrides
    })
  ).toString('base64url')
  return `${encoded}.${createHmac('sha256', 'test-secret:auth-secret').update(encoded).digest('base64url')}`
}

test('rejects unavailable event positions', async () => {
  state.events.push({ cursor: 5 })
  await assert.rejects(listRostackEvents(signedCursor(-1), 'key-1'), {
    code: 'cursor_unavailable'
  })
  await assert.rejects(listRostackEvents(signedCursor('wrong'), 'key-1'), {
    code: 'cursor_unavailable'
  })
  await assert.rejects(listRostackEvents(signedCursor(1), 'key-1'), {
    code: 'cursor_unavailable'
  })
  await assert.rejects(listRostackEvents(signedCursor(6), 'key-1'), {
    code: 'cursor_unavailable'
  })
  await assert.rejects(listRostackEvents(signedCursor(5, { api: 'wrong' }), 'key-1'), {
    code: 'cursor_scope_mismatch'
  })
  await assert.rejects(listRostackEvents(signedCursor(5, { resource: 'wrong' }), 'key-1'), {
    code: 'cursor_scope_mismatch'
  })

  const valid = signedCursor(5)
  const [payload, signature] = valid.split('.')
  const replacement = signature.endsWith('A') ? 'B' : 'A'
  await assert.rejects(
    listRostackEvents(`${payload}.${signature.slice(0, -1)}${replacement}`, 'key-1'),
    {
      code: 'cursor_unavailable'
    }
  )
})

test('handles an empty event stream', async () => {
  const cursor = await currentRostackCursor('key-1')
  assert.deepEqual(await listRostackEvents(cursor, 'key-1'), [])
})

test('cleans expired snapshots and events', async () => {
  await cleanupRostackState()
  assert.equal(state.deleted, 2)
})
