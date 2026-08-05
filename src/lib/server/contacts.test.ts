import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'

const state = vi.hoisted(() => {
  const selections: unknown[][] = []
  const insertions: unknown[] = []
  const updates: unknown[] = []
  const deletions: unknown[] = []
  const operations: Array<{ name: string; args: unknown[] }> = []
  const table = (name: string) =>
    new Proxy({ name }, { get: (target, key) => `${target.name}.${String(key)}` })
  const mailContact = table('contact')
  const mailContactGroup = table('group')
  const mailContactGroupMember = table('member')
  const mailMessage = table('message')
  const mailMessageMailbox = table('mailbox')
  type Query = Promise<unknown[]> & {
    from: (value: unknown) => Query
    innerJoin: (left: unknown, right: unknown) => Query
    where: (value: unknown) => Query
    orderBy: (...values: unknown[]) => Query
    limit: (value: number) => Promise<unknown[]>
  }
  const query = (result: unknown[]) => {
    const value = Promise.resolve(result) as Query
    Object.assign(value, {
      from: (table: unknown) => {
        operations.push({ name: 'from', args: [table] })
        return value
      },
      innerJoin: (left: unknown, right: unknown) => {
        operations.push({ name: 'innerJoin', args: [left, right] })
        return value
      },
      where: (where: unknown) => {
        operations.push({ name: 'where', args: [where] })
        return value
      },
      orderBy: (...order: unknown[]) => {
        operations.push({ name: 'orderBy', args: order })
        return value
      },
      limit: async (limit: number) => {
        operations.push({ name: 'limit', args: [limit] })
        return result
      }
    })
    return value
  }
  const db = {
    select: vi.fn(() => query(selections.shift() ?? [])),
    insert: vi.fn(() => {
      const chain = {
        values(value: unknown) {
          insertions.push(value)
          return chain
        },
        onConflictDoUpdate: async (value: unknown) =>
          operations.push({ name: 'upsert', args: [value] }),
        onConflictDoNothing: async () => operations.push({ name: 'ignore-conflicts', args: [] }),
        returning: async () => selections.shift() ?? []
      }
      return chain
    }),
    update: vi.fn(() => {
      const chain = {
        set(value: unknown) {
          updates.push(value)
          return chain
        },
        where: () => chain,
        returning: async () => selections.shift() ?? []
      }
      return chain
    }),
    delete: vi.fn(() => {
      const chain = {
        where(value: unknown) {
          deletions.push(value)
          return Promise.resolve()
        }
      }
      return chain
    })
  }
  return {
    selections,
    insertions,
    updates,
    deletions,
    operations,
    db,
    mailContact,
    mailContactGroup,
    mailContactGroupMember,
    mailMessage,
    mailMessageMailbox
  }
})

vi.mock('./db', () => ({ db: state.db }))
vi.mock('./db/schema', () => ({
  mailContact: state.mailContact,
  mailContactGroup: state.mailContactGroup,
  mailContactGroupMember: state.mailContactGroupMember,
  mailMessage: state.mailMessage,
  mailMessageMailbox: state.mailMessageMailbox
}))
vi.mock('drizzle-orm', () => ({
  asc: vi.fn((value) => `asc:${value}`),
  desc: vi.fn((value) => `desc:${value}`),
  eq: vi.fn((left, right) => `eq:${left}:${right}`),
  ilike: vi.fn((left, right) => `ilike:${left}:${right}`),
  inArray: vi.fn((left, right) => `in:${left}:${right.join('|')}`),
  or: vi.fn((...values) => `or:${values.join('|')}`),
  sql: Object.assign(
    vi.fn((parts: TemplateStringsArray) => parts.join('?')),
    { raw: vi.fn() }
  )
}))

const contacts = await import('./contacts.ts')

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    source: 'manual',
    useCount: 3,
    lastUsedAt: new Date('2024-02-03T04:05:06.000Z'),
    updatedAt: new Date('2024-02-04T04:05:06.000Z'),
    ...overrides
  }
}

beforeEach(() => {
  state.selections.length = 0
  state.insertions.length = 0
  state.updates.length = 0
  state.deletions.length = 0
  state.operations.length = 0
  vi.clearAllMocks()
})

describe('contact parsing and CSV', () => {
  test('normalizes and validates email addresses', () => {
    assert.equal(contacts.normalizeEmail(' Ada@Example.Test '), 'ada@example.test')
    assert.equal(contacts.validateEmail(' Ada@Example.Test '), true)
    assert.equal(contacts.validateEmail('not an address'), false)
  })

  test('previews empty, malformed, quoted, duplicate, and invalid CSV rows', () => {
    assert.deepEqual(contacts.previewContactCsv(' \r\n'), {
      rows: [],
      validCount: 0,
      duplicateCount: 0,
      invalidCount: 0
    })
    assert.deepEqual(contacts.previewContactCsv('Name\nAda'), {
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
    })
    assert.deepEqual(
      contacts.previewContactCsv(
        'Display Name,E-mail\r\n"Ada, ""Countess""", ADA@example.test\r\n,\r\nBad,nope\r\nAgain,ada@example.test'
      ),
      {
        rows: [
          {
            row: 2,
            name: 'Ada, "Countess',
            email: 'ada@example.test',
            status: 'valid',
            error: null
          },
          { row: 3, name: '', email: '', status: 'invalid', error: 'Email is required.' },
          { row: 4, name: 'Bad', email: 'nope', status: 'invalid', error: 'Email is invalid.' },
          {
            row: 5,
            name: 'Again',
            email: 'ada@example.test',
            status: 'duplicate',
            error: 'Duplicate email in CSV.'
          }
        ],
        validCount: 1,
        duplicateCount: 1,
        invalidCount: 2
      }
    )
    assert.deepEqual(contacts.previewContactCsv('email\nada@example.test').rows, [
      { row: 2, name: '', email: 'ada@example.test', status: 'valid', error: null }
    ])
    assert.equal(contacts.previewContactCsv('other,email\nAda').rows[0].email, '')
    assert.equal(contacts.previewContactCsv('email,name\nada@example.test').rows[0].name, '')
  })

  test('converts valid CSV rows, safely serializes CSV, and formats contacts', () => {
    assert.deepEqual(
      contacts.contactCsvInputs('full name,email address\n" Ada ",ADA@example.test\nBad,nope'),
      [{ name: 'Ada', email: 'ada@example.test', source: 'manual', useCount: 0, lastUsedAt: null }]
    )
    assert.equal(
      contacts.serializeContactsCsv([{ name: 'A, B', email: '=bad@example.test' }]),
      'name,email\n"A, B",\'=bad@example.test'
    )
    assert.equal(
      contacts.serializeContactsCsv([{ name: null, email: undefined } as never]),
      'name,email\n,'
    )
    assert.equal(
      contacts.contactDisplay({ name: '', email: 'ada@example.test' }),
      'ada@example.test'
    )
    assert.equal(
      contacts.contactDisplay({ name: 'Ada', email: 'ada@example.test' }),
      'Ada <ada@example.test>'
    )
  })

  test('parses address lists and keeps named contacts when fields overlap', () => {
    assert.deepEqual(contacts.parseAddressList(undefined), [])
    assert.deepEqual(
      contacts.parseAddressList('"Ada" <ADA@example.test>, bob@example.test; ADA@example.test'),
      [
        { name: 'Ada', email: 'ada@example.test' },
        { name: '', email: 'bob@example.test' }
      ]
    )
    assert.deepEqual(contacts.parseAddressList('< >'), [])
    assert.deepEqual(
      contacts.parseAddressFields(['ada@example.test', 'Ada <ada@example.test>', null]),
      [{ name: 'Ada', email: 'ada@example.test' }]
    )
    assert.deepEqual(
      contacts.parseAddressFields(['Ada <ada@example.test>', 'Ada <ada@example.test>']),
      [{ name: 'Ada', email: 'ada@example.test' }]
    )
  })
})

describe('contact persistence', () => {
  test('normalizes, merges, and batches contact upserts', async () => {
    const later = new Date('2025-01-01T00:00:00.000Z')
    await contacts.upsertContacts([
      {
        name: ' Old ',
        email: 'ADA@example.test',
        source: 'manual',
        useCount: -1,
        lastUsedAt: later
      },
      {
        name: '',
        email: 'ada@example.test',
        source: 'auto',
        useCount: 2,
        lastUsedAt: new Date('2024-01-01T00:00:00.000Z')
      },
      {
        name: '',
        email: 'ada@example.test',
        source: 'auto',
        useCount: 1,
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z')
      },
      { name: 'Ignored', email: '   ' },
      { name: 'Automatic', email: 'automatic@example.test' },
      {
        name: '',
        email: 'automatic@example.test',
        source: 'manual',
        useCount: 0,
        lastUsedAt: null
      },
      ...Array.from({ length: 200 }, (_, index) => ({
        name: `User ${index}`,
        email: `user${index}@example.test`,
        useCount: 0
      }))
    ])
    assert.equal(state.insertions.length, 2)
    const first = state.insertions[0] as Array<Record<string, unknown>>
    assert.deepEqual(first[0], {
      name: 'Old',
      email: 'ada@example.test',
      source: 'manual',
      useCount: 3,
      lastUsedAt: new Date('2026-01-01T00:00:00.000Z')
    })
    assert.equal((state.insertions[1] as unknown[]).length, 2)
    assert.equal(state.operations.filter((operation) => operation.name === 'upsert').length, 2)
  })

  test('lists, finds, exports, and gets serialized contacts', async () => {
    state.selections.push(
      [contact()],
      [contact({ id: 2, name: '', lastUsedAt: null })],
      [],
      [contact()],
      [contact()]
    )
    assert.equal(
      (await contacts.listContacts(' ada ', 2))[0].display,
      'Ada Lovelace <ada@example.test>'
    )
    assert.equal((await contacts.listContacts())[0].lastUsedAt, null)
    assert.equal(await contacts.getContactById(1), null)
    assert.equal((await contacts.getContactById(1))?.updatedAt, '2024-02-04T04:05:06.000Z')
    assert.equal((await contacts.listContactsForExport())[0].id, 1)
  })

  test('finds a contact by normalized email', async () => {
    state.selections.push([], [contact()])
    assert.equal(await contacts.findContactByEmail('missing@example.test'), null)
    assert.equal(
      (await contacts.findContactByEmail(' ADA@example.test '))?.email,
      'ada@example.test'
    )
  })

  test('lists unique matching messages up to the requested limit', async () => {
    state.selections.push([
      {
        id: 1,
        messageId: 'one',
        mailbox: 'INBOX',
        uid: 1,
        flags: '["\\\\Seen"]',
        subject: 'One',
        from: 'ada@example.test',
        to: '',
        cc: '',
        preview: 'first',
        receivedAt: new Date('2024-01-01T00:00:00.000Z'),
        threadId: 'thread'
      },
      {
        id: 2,
        messageId: 'one',
        mailbox: 'Archive',
        uid: 2,
        flags: '[]',
        subject: 'Duplicate',
        from: '',
        to: '',
        cc: '',
        preview: '',
        receivedAt: null,
        threadId: null
      },
      {
        id: 3,
        messageId: 'two',
        mailbox: 'INBOX',
        uid: 3,
        flags: '[]',
        subject: 'Two',
        from: '',
        to: '',
        cc: '',
        preview: 'second',
        receivedAt: null,
        threadId: null
      }
    ])
    assert.deepEqual(await contacts.listMessagesForContact(' ADA@example.test ', 1), [
      {
        id: 1,
        messageId: 'one',
        mailbox: 'INBOX',
        uid: 1,
        flags: ['\\Seen'],
        subject: 'One',
        from: 'ada@example.test',
        to: '',
        cc: '',
        preview: 'first',
        receivedAt: '2024-01-01T00:00:00.000Z',
        threadId: 'thread'
      }
    ])
    assert.deepEqual(state.operations.find((operation) => operation.name === 'limit')?.args, [3])
    state.selections.push([
      {
        id: 1,
        messageId: 'one',
        mailbox: 'INBOX',
        uid: 1,
        flags: '[]',
        subject: 'One',
        from: '',
        to: '',
        cc: '',
        preview: '',
        receivedAt: null,
        threadId: null
      },
      {
        id: 2,
        messageId: 'one',
        mailbox: 'Archive',
        uid: 2,
        flags: '[]',
        subject: 'Duplicate',
        from: '',
        to: '',
        cc: '',
        preview: '',
        receivedAt: null,
        threadId: null
      },
      {
        id: 3,
        messageId: 'two',
        mailbox: 'INBOX',
        uid: 3,
        flags: '[]',
        subject: 'Two',
        from: '',
        to: '',
        cc: '',
        preview: 'second',
        receivedAt: null,
        threadId: null
      }
    ])
    assert.deepEqual(
      (await contacts.listMessagesForContact('ada@example.test', 3)).map(
        (message) => message.messageId
      ),
      ['one', 'two']
    )
  })
})

describe('contact groups and message import', () => {
  test('lists empty groups and groups with serialized members', async () => {
    state.selections.push(
      [],
      [
        {
          id: 1,
          name: 'Friends',
          description: 'People',
          updatedAt: new Date('2024-01-01T00:00:00.000Z')
        },
        { id: 2, name: 'Empty', description: '', updatedAt: new Date('2024-01-02T00:00:00.000Z') }
      ],
      [{ groupId: 1, contact: contact() }]
    )
    assert.deepEqual(await contacts.listContactGroups(), [])
    assert.deepEqual(await contacts.listContactGroups(' friend ', 2), [
      {
        id: 1,
        name: 'Friends',
        description: 'People',
        display: 'Friends (1)',
        members: [
          {
            id: 1,
            name: 'Ada Lovelace',
            email: 'ada@example.test',
            display: 'Ada Lovelace <ada@example.test>',
            source: 'manual',
            useCount: 3,
            lastUsedAt: '2024-02-03T04:05:06.000Z',
            updatedAt: '2024-02-04T04:05:06.000Z'
          }
        ],
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 2,
        name: 'Empty',
        description: '',
        display: 'Empty (0)',
        members: [],
        updatedAt: '2024-01-02T00:00:00.000Z'
      }
    ])
  })

  test('saves new and existing groups, including missing groups and member changes', async () => {
    state.selections.push(
      [],
      [{ id: 1, name: 'New', description: '', updatedAt: new Date('2024-01-01T00:00:00.000Z') }],
      [],
      [
        {
          id: 2,
          name: 'Existing',
          description: 'Old',
          updatedAt: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      [
        {
          id: 2,
          name: 'Existing',
          description: 'Trimmed',
          updatedAt: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      [{ groupId: 2, contact: contact() }],
      [
        {
          id: 3,
          name: 'No description',
          description: '',
          updatedAt: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      []
    )
    assert.equal(await contacts.saveContactGroup({ name: ' Missing ', contactIds: [] }), null)
    assert.deepEqual(await contacts.saveContactGroup({ name: ' New ', contactIds: [] }), {
      id: 1,
      name: 'New',
      description: '',
      display: 'New (0)',
      members: [],
      updatedAt: '2024-01-01T00:00:00.000Z'
    })
    assert.equal(
      (
        await contacts.saveContactGroup({
          id: 2,
          name: ' Existing ',
          description: ' Trimmed ',
          contactIds: [1, 1, 0, -2, Infinity]
        })
      )?.members.length,
      1
    )
    assert.equal(
      (await contacts.saveContactGroup({ id: 3, name: ' No description ', contactIds: [] }))
        ?.description,
      ''
    )
    assert.equal((state.insertions.at(-1) as Array<Record<string, number>>)[0].contactId, 1)
    assert.equal(state.updates.length, 2)
  })

  test('deletes groups and contacts and imports message addresses', async () => {
    await contacts.deleteContactGroup(1)
    await contacts.deleteContact(2)
    assert.equal(state.deletions.length, 4)
    state.selections.push([
      {
        from: 'Ada <ada@example.test>',
        to: 'bob@example.test',
        cc: null,
        replyTo: null,
        receivedAt: null
      }
    ])
    assert.equal(await contacts.importContactsFromMessages(7), 2)
    assert.equal((state.insertions[0] as unknown[]).length, 2)
    assert.deepEqual(state.operations.find((operation) => operation.name === 'limit')?.args, [7])
  })
})
