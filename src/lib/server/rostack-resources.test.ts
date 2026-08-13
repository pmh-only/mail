import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  pages: [] as Record<string, unknown>[]
}))

function queryResult(selection?: Record<string, unknown>) {
  const query: Record<string, unknown> = {}
  for (const method of ['from', 'orderBy', 'where', 'limit']) query[method] = vi.fn(() => query)
  // oxlint-disable-next-line unicorn/no-thenable
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(
      selection
        ? state.rows.map((row) =>
            Object.fromEntries(Object.keys(selection).map((key) => [key, row[key]]))
          )
        : state.rows
    ).then(resolve)
  return query
}

const db = vi.hoisted(() => ({
  select: vi.fn((selection?: Record<string, unknown>) => queryResult(selection)),
  insert: vi.fn(() => ({
    values: vi.fn(async (values: Record<string, unknown>[]) => state.pages.push(...values))
  }))
}))

vi.mock('./db', () => ({ db }))
vi.mock('./db/schema', () => {
  const columns = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, { name, toString: () => name }]))
  return {
    mailAttachment: columns(['id', 'messageId', 'filename', 'contentType', 'size']),
    mailContact: columns(['id', 'email', 'name', 'source', 'useCount', 'lastUsedAt', 'updatedAt']),
    mailboxCatalog: columns(['path', 'name', 'delimiter', 'specialUse', 'updatedAt']),
    mailMessage: columns([
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
      'threadKey',
      'receivedAt'
    ]),
    mailThreadSummary: columns(['mailbox', 'threadKey', 'threadCount', 'latestReceivedAt']),
    rostackSnapshotPage: columns([
      'cursor',
      'query',
      'items',
      'nextCursor',
      'eventCursor',
      'expiresAt'
    ]),
    smtpJob: columns([
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
    ])
  }
})

import {
  concreteResourceDiscovery,
  getRostackResource,
  isRostackConcreteResource,
  listRostackResource,
  ROSTACK_CONCRETE_RESOURCES,
  rostackResourceSchema
} from './rostack-resources.ts'

beforeEach(() => {
  state.rows.length = 0
  state.pages.length = 0
  vi.clearAllMocks()
})

test('advertises six closed concrete resource schemas', () => {
  assert.deepEqual(ROSTACK_CONCRETE_RESOURCES, [
    'messages',
    'threads',
    'mailboxes',
    'contacts',
    'attachments',
    'send-jobs'
  ])
  assert.equal(isRostackConcreteResource('messages'), true)
  assert.equal(isRostackConcreteResource('unknown'), false)
  assert.equal(rostackResourceSchema('send-jobs').additionalProperties, false)
  const resources = concreteResourceDiscovery('https://mail.example')
  assert.equal(resources.length, 6)
  assert.equal(resources[0].collection_url, 'https://mail.example/api/rostack/v1/messages')
  assert.deepEqual(resources[0].events, [])
})

test('lists paginated resources without sensitive source fields', async () => {
  state.rows.push(
    {
      id: 1,
      status: 'pending',
      attemptCount: 0,
      availableAt: new Date('2026-08-13T00:00:00Z'),
      lastError: null,
      deliveredAt: null,
      messageId: null,
      openedAt: null,
      createdAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:00:00Z'),
      payload: 'secret'
    },
    {
      id: 2,
      status: 'sent',
      attemptCount: 1,
      availableAt: new Date('2026-08-13T00:00:00Z'),
      lastError: null,
      deliveredAt: new Date('2026-08-13T00:01:00Z'),
      messageId: 'message-2',
      openedAt: null,
      createdAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:01:00Z')
    }
  )
  const result = await listRostackResource(
    'send-jobs',
    new URL('https://mail.example/api/rostack/v1/send-jobs?limit=1'),
    'owner'
  )
  assert.equal(result.page.has_more, true)
  assert.equal(state.pages.length, 1)
  assert.equal('payload' in result.items[0], false)
  assert.equal(result.items[0].availableAt, '2026-08-13T00:00:00.000Z')
})

test('gets projected resources and rejects unsupported queries', async () => {
  state.rows.push({
    id: 4,
    messageId: 'message-4',
    filename: 'report.pdf',
    contentType: 'application/pdf',
    size: 42,
    content: Buffer.from('secret')
  })
  assert.deepEqual(await getRostackResource('attachments', '4', '/id,/downloadUrl'), {
    id: 4,
    downloadUrl: '/api/external/v1/attachments/4'
  })
  await assert.rejects(getRostackResource('attachments', '5', null), {
    code: 'resource-not-found'
  })
  await assert.rejects(
    listRostackResource(
      'attachments',
      new URL('https://mail.example/api/rostack/v1/attachments?sort=/filename'),
      'owner'
    ),
    { code: 'invalid-sort' }
  )
})

test.each([
  [
    'messages',
    {
      id: 1,
      messageId: 'message-1',
      subject: 'Subject',
      from: 'from@example.com',
      to: 'to@example.com',
      cc: '',
      replyTo: null,
      preview: 'Preview',
      textContent: 'Body',
      htmlContent: null,
      inReplyTo: null,
      references: null,
      threadId: 'thread-1',
      receivedAt: null
    },
    {
      id: 1,
      messageId: 'message-1',
      subject: 'Subject',
      from: 'from@example.com',
      to: 'to@example.com',
      cc: '',
      replyTo: null,
      preview: 'Preview',
      textContent: 'Body',
      htmlContent: null,
      inReplyTo: null,
      references: null,
      threadId: 'thread-1',
      receivedAt: null
    }
  ],
  [
    'threads',
    {
      mailbox: 'INBOX/Subfolder',
      threadKey: 'thread:1',
      threadCount: 2,
      latestReceivedAt: new Date('2026-08-13T00:00:00Z')
    },
    {
      id: Buffer.from(JSON.stringify(['INBOX/Subfolder', 'thread:1'])).toString('base64url'),
      mailbox: 'INBOX/Subfolder',
      threadId: 'thread:1',
      messageCount: 2,
      latestReceivedAt: '2026-08-13T00:00:00.000Z'
    }
  ],
  [
    'mailboxes',
    {
      path: 'INBOX',
      name: 'Inbox',
      delimiter: '/',
      specialUse: '\\Inbox',
      updatedAt: new Date('2026-08-13T00:00:00Z')
    },
    {
      id: 'INBOX',
      name: 'Inbox',
      delimiter: '/',
      specialUse: '\\Inbox',
      updatedAt: '2026-08-13T00:00:00.000Z'
    }
  ],
  [
    'contacts',
    {
      id: 2,
      email: 'person@example.com',
      name: 'Person',
      source: 'manual',
      useCount: 3,
      lastUsedAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:00:00Z')
    },
    {
      id: 2,
      email: 'person@example.com',
      name: 'Person',
      source: 'manual',
      useCount: 3,
      lastUsedAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    }
  ]
] as const)('serializes the %s resource', async (resource, row, expected) => {
  state.rows.push(row)
  const result = await listRostackResource(
    resource,
    new URL(`https://mail.example/api/rostack/v1/${resource}`),
    'owner'
  )
  assert.deepEqual(result.items[0], expected)
})

test('supports id filters, descending order, and empty collections', async () => {
  state.rows.push(
    { id: 1, messageId: 'one', filename: 'one', contentType: 'text/plain', size: 1 },
    { id: 2, messageId: 'two', filename: 'two', contentType: 'text/plain', size: 2 }
  )
  const eqUrl = new URL('https://mail.example/api/rostack/v1/attachments?sort=-/id')
  eqUrl.searchParams.set('filter', JSON.stringify({ '/id': { eq: 2 } }))
  assert.deepEqual((await listRostackResource('attachments', eqUrl, 'owner')).items[0].id, 2)

  const inUrl = new URL('https://mail.example/api/rostack/v1/attachments')
  inUrl.searchParams.set('filter', JSON.stringify({ '/id': { in: [1] } }))
  assert.deepEqual((await listRostackResource('attachments', inUrl, 'owner')).items[0].id, 1)

  state.rows.length = 0
  assert.deepEqual(
    (
      await listRostackResource(
        'attachments',
        new URL('https://mail.example/api/rostack/v1/attachments'),
        'owner'
      )
    ).items,
    []
  )
})

test.each([
  ['?limit=0', 'invalid-request'],
  ['?fields=/unknown', 'invalid-fields'],
  ['?filter=bad', 'invalid-filter'],
  [
    `?filter=${encodeURIComponent(JSON.stringify({ '/filename': { eq: 'file' } }))}`,
    'unsupported-filter'
  ],
  [`?filter=${encodeURIComponent(JSON.stringify({ '/id': { gt: 1 } }))}`, 'unsupported-filter'],
  [`?filter=${encodeURIComponent(JSON.stringify({ '/id': null }))}`, 'unsupported-filter']
])('rejects invalid concrete resource query %s', async (search, code) => {
  await assert.rejects(
    listRostackResource(
      'attachments',
      new URL(`https://mail.example/api/rostack/v1/attachments${search}`),
      'owner'
    ),
    { code }
  )
})

test('reads only matching unexpired continuation pages', async () => {
  const url = new URL('https://mail.example/api/rostack/v1/contacts?cursor=page-1&limit=2')
  state.rows.push({
    cursor: 'page-1',
    query: 'owner\ncontacts\nfilter=&sort=&fields=&limit=2',
    items: [{ id: 2 }],
    nextCursor: 'page-2',
    eventCursor: '',
    expiresAt: new Date(Date.now() + 60_000)
  })
  const page = await listRostackResource('contacts', url, 'owner')
  assert.deepEqual(page.items, [{ id: 2 }])
  assert.equal(page.page.has_more, true)

  state.rows[0].nextCursor = null
  assert.equal((await listRostackResource('contacts', url, 'owner')).page.has_more, false)
  state.rows.length = 0
  await assert.rejects(listRostackResource('contacts', url, 'owner'), { code: 'invalid-cursor' })
  state.rows.push({
    query: 'wrong',
    expiresAt: new Date(Date.now() + 60_000),
    items: [],
    nextCursor: null
  })
  await assert.rejects(listRostackResource('contacts', url, 'owner'), { code: 'invalid-cursor' })
  state.rows[0].query = 'owner\ncontacts\nfilter=&sort=&fields=&limit=2'
  state.rows[0].expiresAt = new Date(0)
  await assert.rejects(listRostackResource('contacts', url, 'owner'), { code: 'invalid-cursor' })
})
