import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  demoMode: true,
  configs: [] as Array<Record<string, unknown>>,
  smtpConfigs: [] as Array<Record<string, unknown>>,
  config: { missing: ['IMAP_HOST'] } as Record<string, unknown>,
  queryResults: [] as unknown[],
  insertReturningResults: [] as unknown[],
  calls: [] as Array<{ operation: string; values?: unknown; set?: unknown; returning?: boolean }>,
  connections: [] as Array<Record<string, unknown> | Error>,
  invalidated: [] as Array<{ configId: string; connection: unknown }>,
  moves: [] as Array<{ uid: number; mailbox: string; targetMailbox: string }>,
  dismissedNotifications: [] as number[][],
  sentPushes: [] as Array<Record<string, unknown>>,
  filteredMessageIds: [] as string[][],
  shouldNotifyMailbox: true,
  openPgpResult: null as Record<string, unknown> | null,
  openPgpResults: [] as Array<Record<string, unknown>>,
  lookupKeys: [] as Array<Record<string, unknown>>,
  parsedAddresses: [] as Array<{ email: string }>,
  composedMailbox: null as Record<string, unknown> | null,
  transactionCalls: [] as unknown[][],
  trustedAuthservIds: '',
  privateKeys: [] as unknown[],
  publicKeys: [] as Array<{ getFingerprint: () => string }>,
  pushError: null as Error | null,
  simpleParserOverride: null as
    | ((parsed: Record<string, unknown>) => Record<string, unknown>)
    | null,
  demoStoredMessageOverride: null as Record<string, unknown> | null,
  dismissPush: vi.fn(async (messageIds: number[]) => {
    state.dismissedNotifications.push(messageIds)
  }),
  processInboundOpenPgp: vi.fn(),
  logServerError: vi.fn(),
  upsertContacts: vi.fn(),
  readKey: vi.fn<(options: { armoredKey: string }) => Promise<unknown>>(async () => {
    throw new Error('Invalid public key')
  })
}))

const query = (operation: string) => {
  const call: { operation: string; values?: unknown; set?: unknown; returning?: boolean } = {
    operation
  }
  state.calls.push(call)
  const query: Record<string, unknown> = {}
  for (const method of [
    'from',
    'where',
    'limit',
    'orderBy',
    'innerJoin',
    'leftJoin',
    'groupBy',
    'values',
    'set',
    'onConflictDoUpdate',
    'onConflictDoNothing',
    'returning',
    'delete',
    'offset'
  ]) {
    query[method] = (value?: unknown) => {
      if (method === 'values') call.values = value
      if (method === 'set') call.set = value
      if (method === 'returning') call.returning = true
      return query
    }
  }
  // oxlint-disable-next-line unicorn/no-thenable -- mocks drizzle's thenable query builder
  query.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => {
    const result =
      call.operation === 'insert' && call.returning && state.insertReturningResults.length > 0
        ? state.insertReturningResults.shift()
        : (state.queryResults.shift() ?? [])
    return result instanceof Error
      ? Promise.reject<unknown[]>(result).then(resolve, reject)
      : Promise.resolve(result as unknown[]).then(resolve, reject)
  }
  return query
}

vi.mock('./db', () => ({
  db: {
    select: () => query('select'),
    selectDistinct: () => query('selectDistinct'),
    insert: () => query('insert'),
    update: () => query('update'),
    delete: () => query('delete'),
    transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
      callback({
        select: () => query('select'),
        insert: () => query('insert'),
        update: () => query('update'),
        delete: () => query('delete'),
        execute: vi.fn(async () => [])
      })
  },
  client: {
    begin: vi.fn(async (callback: (tx: (...args: unknown[]) => unknown) => Promise<unknown>) => {
      const tx = (...args: unknown[]) => {
        state.transactionCalls.push(args)
        return []
      }
      return callback(tx)
    })
  }
}))

vi.mock('./demo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./demo')>()
  return {
    ...actual,
    isDemoModeEnabled: () => state.demoMode,
    getDemoStoredMessageById: ((id) =>
      state.demoStoredMessageOverride ??
      actual.getDemoStoredMessageById(id)) as typeof actual.getDemoStoredMessageById
  }
})

vi.mock('./config', () => ({
  getImapConfigs: vi.fn(async () => state.configs),
  getImapConfig: vi.fn(async () => state.config),
  getSmtpConfigs: vi.fn(async () => state.smtpConfigs)
}))

vi.mock('./imap-connections', () => ({
  getWorkerConnection: vi.fn(async () => {
    const connection = state.connections.shift()
    if (!connection) throw new Error('Unexpected IMAP connection')
    if (connection instanceof Error) throw connection
    return connection
  }),
  invalidateWorkerConnection: vi.fn((configId: string, connection: unknown) => {
    state.invalidated.push({ configId, connection })
  })
}))

vi.mock('./imap-operations', () => ({
  scheduleMoveMessage: vi.fn(async (uid: number, mailbox: string, targetMailbox: string) => {
    state.moves.push({ uid, mailbox, targetMailbox })
  })
}))

vi.mock('./push', () => ({
  dismissReadNotifications: state.dismissPush,
  sendPushToAll: vi.fn(async (notification: Record<string, unknown>) => {
    if (state.pushError) throw state.pushError
    state.sentPushes.push(notification)
  })
}))

vi.mock('$env/dynamic/private', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, property) =>
        property === 'MAIL_AUTH_TRUSTED_AUTHSERV_IDS' ? state.trustedAuthservIds : undefined
    }
  )
}))

vi.mock('./filters', () => ({
  runFiltersOnMessages: vi.fn(async (messageIds: string[]) => {
    state.filteredMessageIds.push(messageIds)
  })
}))

vi.mock('./mailbox-notifications', () => ({
  shouldSendMailboxNotifications: vi.fn(async () => state.shouldNotifyMailbox)
}))

vi.mock('./composed-mailboxes', () => ({
  getComposedMailboxBySlug: vi.fn(async () => state.composedMailbox)
}))

vi.mock('./perf', () => ({
  logServerError: state.logServerError,
  perfError: vi.fn(),
  perfLog: vi.fn(),
  perfMs: () => 0,
  perfNow: () => 0
}))

vi.mock('./contacts', () => ({
  parseAddressFields: vi.fn(() => state.parsedAddresses),
  upsertContacts: state.upsertContacts
}))

vi.mock('./openpgp-keys', () => ({
  getOpenPgpPrivateKeys: vi.fn(async () => state.privateKeys),
  getOpenPgpPublicKeys: vi.fn(async () => state.publicKeys)
}))

vi.mock('./openpgp-keyservers.ts', () => ({
  lookupOpenPgpKeysByEmail: vi.fn(async () => state.lookupKeys)
}))

vi.mock('./openpgp-message', () => ({
  processInboundOpenPgp: state.processInboundOpenPgp.mockImplementation(
    async ({ raw }: { raw: Buffer }) =>
      state.openPgpResults.shift() ??
      state.openPgpResult ?? {
        signed: true,
        signatureStatus: 'unknown',
        signer: null,
        fingerprint: null,
        encrypted: false,
        decrypted: false,
        error: null,
        rawMessage: raw
      }
  )
}))

vi.mock('openpgp', () => ({ readKey: state.readKey }))

vi.mock('mailparser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mailparser')>()
  return {
    ...actual,
    simpleParser: (async (source: Parameters<typeof actual.simpleParser>[0]) => {
      const parsed = await actual.simpleParser(source)
      return state.simpleParserOverride
        ? state.simpleParserOverride(parsed as unknown as Record<string, unknown>)
        : parsed
    }) as typeof actual.simpleParser
  }
})

import {
  backfillMailAuthenticationFromWorker,
  backfillOpenPgpFromWorker,
  countMessagesBySender,
  countSearchMessages,
  countSharedMessageReads,
  countStoredMessages,
  countStoredMessagesInMailboxes,
  countStoredThreads,
  countStoredThreadsInMailboxes,
  createShareToken,
  createThreadShareToken,
  getImapMailboxes,
  getMailboxRole,
  getMailboxSyncPollMs,
  getMailboxSyncStatus,
  getMessageByShareToken,
  getMessagesInMailboxesThread,
  getMessagesInThread,
  getSharedMessagesByShareToken,
  getStoredMessageById,
  getStoredRawMessageById,
  getSyncSummary,
  getThreadMetadata,
  listImapMailboxes,
  listMessagesBySender,
  listStoredMessages,
  listStoredMessagesInMailboxes,
  listStoredThreads,
  listStoredThreadsInMailboxes,
  markMessagesSeen,
  markMailboxMessagesSeen,
  markMessageAsRead,
  markMessageAsUnread,
  markShareTokenAsRead,
  moveMessage,
  normalizeSenderAddress,
  purgeOrphanedMessages,
  repairThreadKeys,
  refreshThreadSummaries,
  resolveMailboxPath,
  resolveMailboxScope,
  revokeShareToken,
  runMailboxSyncOnce,
  searchMessages,
  searchMessagesByRegex,
  setThreadMetadata,
  snoozeMessages,
  touchSyncWorkerHeartbeat,
  type MailRow
} from './mail.ts'
import { resetDemoState } from './demo.ts'

beforeEach(() => {
  resetDemoState()
  state.demoMode = true
  state.configs = []
  state.smtpConfigs = []
  state.config = { missing: ['IMAP_HOST'] }
  state.queryResults = []
  state.insertReturningResults = []
  state.calls = []
  state.connections = []
  state.invalidated = []
  state.moves = []
  state.dismissedNotifications = []
  state.sentPushes = []
  state.filteredMessageIds = []
  state.shouldNotifyMailbox = true
  state.openPgpResult = null
  state.openPgpResults = []
  state.lookupKeys = []
  state.parsedAddresses = []
  state.composedMailbox = null
  state.transactionCalls = []
  state.trustedAuthservIds = ''
  state.privateKeys = []
  state.publicKeys = []
  state.pushError = null
  state.simpleParserOverride = null
  state.demoStoredMessageOverride = null
  state.dismissPush.mockReset()
  state.dismissPush.mockImplementation(async (messageIds: number[]) => {
    state.dismissedNotifications.push(messageIds)
  })
  state.processInboundOpenPgp.mockClear()
  state.logServerError.mockReset()
  state.upsertContacts.mockReset()
  state.upsertContacts.mockResolvedValue(undefined)
  state.readKey.mockReset()
  state.readKey.mockRejectedValue(new Error('Invalid public key'))
  vi.useRealTimers()
})

test('normalizes addresses and recognizes mailbox actions', () => {
  assert.equal(normalizeSenderAddress('Ada <ADA@Example.COM>'), 'ada@example.com')
  assert.equal(normalizeSenderAddress(undefined), '')
  assert.equal(getMailboxRole('받은메일함'), 'inbox')
  assert.equal(getMailboxRole('[Gmail]/All Mail'), 'archive')
  assert.equal(getMailboxRole('Elsewhere'), null)
})

test('uses demo sync and mailbox data without DB or IMAP', async () => {
  assert.equal(await backfillOpenPgpFromWorker(), 0)
  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.equal(await getMailboxSyncPollMs(), null)
  assert.equal(await runMailboxSyncOnce(), false)
  assert.equal(await purgeOrphanedMessages(), 0)
  assert.equal(await markMessagesSeen([], true), 0)
  await repairThreadKeys()
  await refreshThreadSummaries('Inbox', [])

  const summary = await getSyncSummary()
  assert.equal(summary.configured, true)
  assert.equal(summary.syncing, false)
  assert.ok(summary.lastSyncedAt)

  const mailboxes = await getImapMailboxes()
  assert.ok(mailboxes.some((mailbox) => mailbox.path === 'Inbox'))
  assert.deepEqual(listImapMailboxes(), [])
  assert.equal(await resolveMailboxPath('inbox', mailboxes), 'Inbox')
  assert.deepEqual(await resolveMailboxScope('inbox', mailboxes), {
    path: 'Inbox',
    paths: ['Inbox'],
    composedMailbox: null
  })
  assert.equal((await getMailboxSyncStatus('Inbox')).reason, 'Demo data is preloaded.')
  assert.deepEqual(await getThreadMetadata('Inbox', 'thread'), { starred: false, pinned: false })
  assert.deepEqual(await setThreadMetadata('Inbox', 'thread', { starred: true }), {
    starred: true,
    pinned: false
  })
  await touchSyncWorkerHeartbeat()
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { workerHeartbeatAt?: Date } | undefined)?.workerHeartbeatAt instanceof Date
    )
  )
})

test('lists, counts, searches, and combines demo messages and threads', async () => {
  const inbox = await listStoredMessages('Inbox')
  assert.ok(inbox.length > 0)
  assert.equal(await countStoredMessages('Inbox'), inbox.length)
  assert.deepEqual(await listStoredMessages('Sent', 10, 0, true), [])
  assert.equal(await countStoredMessages('Sent', true), 0)
  assert.deepEqual(await listStoredMessages('Inbox', 10, 0, false, 'starred'), [])
  assert.equal(await countStoredMessages('Inbox', false, 'starred'), 0)

  const combined = await listStoredMessagesInMailboxes(['Inbox', 'Archive'])
  assert.ok(combined.length >= inbox.length)
  assert.equal(await countStoredMessagesInMailboxes(['Inbox', 'Archive']), combined.length)

  const senderRows = await listMessagesBySender('Inbox', inbox[0].from)
  assert.ok(senderRows.length > 0)
  assert.equal(await countMessagesBySender('Inbox', inbox[0].from), senderRows.length)
  assert.deepEqual(await listMessagesBySender('Inbox', ''), [])
  assert.equal(await countMessagesBySender('Inbox', ''), 0)

  const threads = await listStoredThreads('Inbox')
  assert.ok(threads.length > 0)
  assert.equal(await countStoredThreads('Inbox'), threads.length)
  assert.deepEqual(await listStoredThreads('Inbox', 10, 0, false, 'pinned'), [])
  assert.equal(await countStoredThreads('Inbox', false, 'pinned'), 0)
  const combinedThreads = await listStoredThreadsInMailboxes(['Inbox', 'Archive'])
  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Archive']), combinedThreads.length)

  const threadRows = await getMessagesInThread(threads[0].threadId!, 'Inbox')
  assert.ok(threadRows.length > 0)
  assert.ok(
    (await getMessagesInMailboxesThread(threads[0].threadId!, ['Inbox', 'Archive'])).length > 0
  )
  const search = await searchMessages(inbox[0].subject, 10, 0)
  assert.ok(search.length > 0)
  assert.ok((await searchMessagesByRegex(inbox[0].subject, 10)).length > 0)
  assert.equal(await countSearchMessages(inbox[0].subject), search.length)
})

test('retrieves raw messages and applies demo state changes', async () => {
  const message = (await listStoredMessages('Inbox'))[0]! as MailRow
  assert.equal((await getStoredMessageById(String(message.id)))?.id, message.id)
  assert.match((await getStoredRawMessageById(message.id))!.toString(), /Message-ID:/)
  assert.equal(await getStoredRawMessageById(-1), undefined)

  assert.equal(await snoozeMessages([], new Date()), 0)
  assert.equal(await snoozeMessages([message.id], new Date(Date.now() + 60_000)), 1)
  assert.equal(
    (await listStoredMessages('Inbox')).some((row) => row.id === message.id),
    false
  )
  assert.equal(await snoozeMessages([message.id], null), 1)

  await markMessageAsRead(message)
  assert.equal((await getStoredMessageById(message.id))!.flags.includes('\\Seen'), true)
  await markMessageAsUnread(message)
  assert.equal((await getStoredMessageById(message.id))!.flags.includes('\\Seen'), false)
  assert.ok((await markMailboxMessagesSeen('inbox')) >= 0)
  assert.equal(await moveMessage(message, 'archive'), 'Archive')
  assert.equal(await moveMessage({ ...message, mailbox: 'Archive' }, 'archive'), null)
})

test('creates, reads, and records demo shares', async () => {
  const message = (await listStoredMessages('Inbox'))[0]!
  const token = await createShareToken(message.id)
  assert.ok(token)
  assert.equal(await createShareToken(message.id), token)
  assert.equal((await getMessageByShareToken(token!))?.messageId, message.messageId)
  await markShareTokenAsRead(token!)
  assert.equal(await countSharedMessageReads(message.messageId), 1)
  assert.equal(await revokeShareToken(token!), false)

  const threadToken = await createThreadShareToken([message.messageId])
  assert.ok(threadToken)
  assert.ok((await getSharedMessagesByShareToken(threadToken!)).length > 0)
  assert.equal(await createThreadShareToken([]), null)
  assert.equal(await getMessageByShareToken('missing'), null)
  assert.deepEqual(await getSharedMessagesByShareToken('missing'), [])
})

const imapConfig = {
  id: 'primary',
  name: 'Primary',
  host: 'imap.example.test',
  port: 993,
  secure: true,
  allowInvalidCertificate: false,
  user: 'ada@example.test',
  password: 'secret',
  mailbox: 'Inbox',
  pollSeconds: 30
}

test('reports non-demo configuration, sync progress, and persisted mailbox state', async () => {
  state.demoMode = false
  state.config = imapConfig
  state.configs = [imapConfig]
  const now = new Date('2026-01-01T12:00:00Z')
  vi.useFakeTimers()
  vi.setSystemTime(now)
  state.queryResults = [
    [
      {
        isSyncing: true,
        activeMailbox: 'Inbox',
        activeStored: 2,
        activeTotal: 5,
        lastError: null
      }
    ],
    [
      { mailbox: 'Archive', lastSyncedAt: new Date('2026-01-01T11:00:00Z'), lastError: 'timeout' },
      { mailbox: 'Inbox', lastSyncedAt: new Date('2026-01-01T11:30:00Z'), lastError: null }
    ],
    [{ isSyncing: false, activeMailbox: null, activeStored: 0, activeTotal: 0, lastError: null }],
    [
      {
        lastFetchedCount: 4,
        lastStoredCount: 4,
        lastSyncedAt: new Date('2026-01-01T11:59:45Z'),
        lastError: null
      }
    ]
  ]

  assert.equal(await getMailboxSyncPollMs(), 30_000)
  assert.deepEqual(await getSyncSummary(), {
    syncing: true,
    configured: true,
    hasError: false,
    lastSyncedAt: '2026-01-01T11:30:00.000Z',
    errorMessage: 'timeout',
    progress: { mailbox: 'Inbox', stored: 2, total: 5 }
  })
  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: true,
    skipped: true,
    syncing: false,
    fetchedCount: 4,
    storedCount: 4,
    lastSyncedAt: '2026-01-01T11:59:45.000Z',
    lastError: null,
    reason: 'Mailbox sync is still fresh.'
  })
})

test('runs a non-demo mailbox sync through listing, catalog persistence, and STATUS fast path', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = {
    list: vi.fn(async () => [
      { path: 'Inbox', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox' },
      { path: 'Archive', name: 'Archive', delimiter: '/', flags: new Set(['\\Noselect']) }
    ])
  }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 7,
        uidValidity: 9,
        highestModseq: 12n,
        lastReconciledAt: new Date(),
        historyComplete: true,
        lastSyncedAt: null,
        lastError: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(listConnection.list.mock.calls.length, 1)
  assert.equal(syncConnection.status.mock.calls.length, 1)
  assert.equal(lock.release.mock.calls.length, 0)
  assert.equal(state.connections.length, 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { path?: string } | undefined)?.path === 'Inbox'
    )
  )
})

test('skips replacing an unchanged mailbox catalog', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = {
    list: vi.fn(async () => [
      { path: 'Archive', name: 'Archive', delimiter: '/', flags: new Set(['\\Noselect']) }
    ])
  }
  state.connections = [listConnection]
  state.queryResults = [
    [],
    [],
    [
      {
        path: 'Archive',
        configId: imapConfig.id,
        remotePath: 'Archive',
        name: 'Archive',
        delimiter: '/',
        specialUse: null
      }
    ],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(listConnection.list.mock.calls.length, 1)
  assert.deepEqual(
    state.calls
      .filter((call) => call.operation === 'insert')
      .map((call) => call.values)
      .filter((values) => (values as { path?: string } | undefined)?.path === 'Archive'),
    []
  )
})

test('records and rethrows non-demo IMAP listing failures while invalidating the connection', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const failedConnection = {
    list: vi.fn(async () => {
      throw new Error('TLS handshake failed')
    })
  }
  state.connections = [failedConnection]
  state.queryResults = [[], [], []]

  await assert.rejects(runMailboxSyncOnce(), /TLS handshake failed/)
  assert.deepEqual(state.invalidated, [{ configId: 'primary', connection: failedConnection }])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError === 'TLS handshake failed'
    )
  )
})

test('marks raw-source rows unavailable when IMAP UIDVALIDITY no longer matches', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 99 }
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 42,
        messageId: '<message@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 1,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ],
    []
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.deepEqual(connection.mailboxOpen.mock.calls, [['Inbox']])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSourceAttempts?: number } | undefined)?.rawSourceAttempts === 2
    )
  )
})

test('fetches, parses, and persists raw source authentication metadata', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const source = Buffer.from(
    [
      'Message-ID: <raw@example.test>',
      'From: ada@example.test <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Raw source',
      'Authentication-Results: mx.example.test; spf=pass smtp.mailfrom=example.test; dkim=pass header.d=example.test; dmarc=pass header.from=example.test',
      '',
      'Body text'
    ].join('\r\n')
  )
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* (_range: string) {
      yield { uid: 7, source }
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 42,
        messageId: '<raw@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 1)
  assert.deepEqual(connection.fetch.mock.calls[0], [
    '7',
    { uid: true, source: true },
    { uid: true }
  ])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSource?: Buffer; spfStatus?: string } | undefined)?.rawSource?.equals(
          source
        ) &&
        (call.set as { spfStatus?: string } | undefined)?.spfStatus === 'pass'
    )
  )
})

test('ingests a fetched IMAP source for an existing message and updates its mailbox entry', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  let time = 0
  const now = vi.spyOn(Date, 'now').mockImplementation(() => (time += 30_000))
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <known@example.test>',
      'From: ada@example.test <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Existing source',
      '',
      'Body text'
    ].join('\r\n')
  )
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) yield { uid: 7, source }
      else
        yield {
          uid: 7,
          envelope: { messageId: '<known@example.test>' },
          flags: new Set<string>(),
          internalDate: new Date('2026-01-01T00:00:00Z')
        }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [{ id: 1, messageId: '<known@example.test>', threadKey: '<known@example.test>' }],
    [],
    [],
    [],
    [{ id: 1 }],
    [],
    [],
    [],
    [],
    [{ representativeMailboxEntryId: 7, latestUid: 7, latestReceivedAt: new Date() }],
    [{ value: 1 }],
    [],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(
    syncConnection.fetch.mock.calls.map(([range]) => range),
    ['7:7', '7']
  )
  assert.equal(lock.release.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (
          call.values as { mailbox?: string; uid?: number; rawSource?: Buffer } | undefined
        )?.rawSource?.equals(source)
    )
  )
  now.mockRestore()
})

test('reconciles changed flags after CONDSTORE rejection and dismisses read notifications', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const syncLock = { release: vi.fn() }
  const reconcileLock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => syncLock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    noop: vi.fn(async () => undefined)
  }
  let rejectCondstore = true
  const reconcileConnection = {
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set(['CONDSTORE']),
    search: vi.fn(async () => [7]),
    fetch: vi.fn(async function* (
      _range: string,
      _query: unknown,
      options: { changedSince?: bigint }
    ) {
      if (rejectCondstore && options.changedSince === 12n) {
        rejectCondstore = false
        throw new Error('CONDSTORE not supported')
      }
      yield { uid: 7, flags: new Set(['\\Seen']) }
    })
  }
  state.connections = [listConnection, syncConnection, reconcileConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 7, uidValidity: 9, highestModseq: 12n, historyComplete: true }],
    [],
    [],
    [{ id: 7, uid: 7, flags: '[]', threadKey: '<thread@example.test>' }],
    [],
    [{ id: 7 }],
    [],
    [],
    [],
    [],
    []
  ]

  await runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set(['Inbox'])]]) })

  assert.deepEqual(
    reconcileConnection.fetch.mock.calls.map(([, , options]) => options),
    [
      { uid: true, changedSince: 12n },
      { uid: true, changedSince: undefined }
    ]
  )
  assert.deepEqual(state.dismissedNotifications, [[7]])
  assert.equal(syncLock.release.mock.calls.length, 1)
  assert.equal(reconcileLock.release.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { flags?: string } | undefined)?.flags === '["\\\\Seen"]'
    )
  )
})

test('updates every copy and queues durable unread jobs', async () => {
  state.demoMode = false
  state.queryResults = [
    [{ messageId: '<shared@example.test>' }],
    [
      {
        id: 1,
        messageId: '<shared@example.test>',
        mailbox: 'Inbox',
        uid: 10,
        flags: '["\\\\Seen"]',
        threadKey: '<thread@example.test>'
      },
      {
        id: 2,
        messageId: '<shared@example.test>',
        mailbox: 'Archive',
        uid: 20,
        flags: '[]',
        threadKey: '<thread@example.test>'
      }
    ],
    [],
    [],
    [{ representativeMailboxEntryId: 2, latestUid: 20, latestReceivedAt: new Date() }],
    [{ value: 2 }],
    [{ representativeMailboxEntryId: 1, latestUid: 10, latestReceivedAt: new Date() }],
    [{ value: 1 }]
  ]

  assert.equal(await markMessagesSeen([1], false), 1)
  const queuedJobs = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      Array.isArray(call.values) &&
      (call.values as Array<{ type?: string }>).some((job) => job.type === 'mark_unread')
  )
  assert.deepEqual(
    (queuedJobs!.values as Array<{ mailbox: string; uid: number; type: string }>).map(
      ({ mailbox, uid, type }) => ({ mailbox, uid, type })
    ),
    [{ mailbox: 'Inbox', uid: 10, type: 'mark_unread' }]
  )
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' && (call.values as { threadCount?: number })?.threadCount === 2
    )
  )
})

test('reads and normalizes persisted mailbox, thread, search, and message rows', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Sent',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: '2026-01-02T00:00:00.000Z',
        threadId: '<thread@example.test>'
      }
    ],
    [{ value: 3 }],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: '2026-01-02T00:00:00.000Z',
        threadId: '<thread@example.test>',
        threadCount: '2',
        hasUnread: true,
        hasImportantUnread: true,
        hasThreadNote: true
      }
    ],
    [{ value: 2 }],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-02T00:00:00Z'),
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null,
        authservId: 'mx.example.test'
      }
    ],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-02T00:00:00Z'),
        threadId: '<thread@example.test>'
      },
      {
        id: 8,
        messageId: '<one@example.test>',
        mailbox: 'Archive',
        uid: 5,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        threadId: '<thread@example.test>'
      }
    ],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-02T00:00:00Z'),
        threadId: '<thread@example.test>'
      },
      {
        id: 8,
        messageId: '<one@example.test>',
        mailbox: 'Archive',
        uid: 5,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        threadId: '<thread@example.test>'
      }
    ],
    [{ value: 4 }],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'One',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-01-02T00:00:00Z'),
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null
      }
    ],
    [{ rawSource: Buffer.from('raw') }]
  ]

  const messages = await listStoredMessages('Sent', 10, 0, false, 'starred')
  assert.ok(messages[0]?.receivedAt instanceof Date)
  assert.equal(await countStoredMessages('Sent', false, 'starred'), 3)
  const threads = await listStoredThreads('Inbox', 10, 0, false, 'pinned')
  assert.deepEqual(
    { threadCount: threads[0]?.threadCount, hasUnread: threads[0]?.hasUnread },
    { threadCount: 2, hasUnread: true }
  )
  assert.equal(await countStoredThreads('Inbox', false, 'pinned'), 2)
  assert.equal((await getMessagesInThread('<thread@example.test>', 'Inbox')).length, 1)
  assert.equal(
    (await getMessagesInMailboxesThread('<thread@example.test>', ['Inbox', 'Archive'])).length,
    1
  )
  assert.equal((await searchMessages('from:ada@example.test one', 10, 0)).length, 1)
  assert.equal(await countSearchMessages('subject:One'), 4)
  assert.equal((await getStoredMessageById('7'))?.textContent, 'Body')
  assert.deepEqual(await getStoredRawMessageById('7'), Buffer.from('raw'))
  assert.equal(await getStoredRawMessageById('not-a-number'), undefined)
})

test('persists thread metadata, snoozes mailbox rows, and handles share records', async () => {
  state.demoMode = false
  state.queryResults = [
    [{ starred: true, pinned: false }],
    [],
    [
      { id: 1, mailbox: 'Inbox', threadKey: '<thread@example.test>' },
      { id: 2, mailbox: 'Inbox', threadKey: '<thread@example.test>' }
    ],
    [],
    [{ representativeMailboxEntryId: 2, latestUid: 9, latestReceivedAt: new Date() }],
    [{ value: 2 }],
    [],
    [],
    [{ token: 'existing-thread-share' }],
    [
      { messageId: '<one@example.test>', messageIds: '["<one@example.test>"]' },
      { messageId: '<other@example.test>', messageIds: 'invalid json' },
      { messageId: '<one@example.test>', messageIds: null }
    ],
    [{ token: 'revoked' }]
  ]

  assert.deepEqual(await setThreadMetadata('Inbox', '<thread@example.test>', { pinned: true }), {
    starred: true,
    pinned: true
  })
  assert.equal(await snoozeMessages([1, 2], new Date('2026-02-01T00:00:00Z')), 2)
  assert.equal(await createShareToken(1), null)
  assert.equal(await createThreadShareToken(['<one@example.test>']), 'existing-thread-share')
  assert.equal(await countSharedMessageReads('<one@example.test>'), 2)
  assert.equal(await revokeShareToken('revoked'), true)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { snoozedUntil?: Date } | undefined)?.snoozedUntil instanceof Date
    )
  )
})

test('fetches persisted sender, regex, and share data and schedules mailbox moves', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [row],
    [{ value: 1 }],
    [row, { ...row, id: 8 }],
    [{ messageId: '<one@example.test>' }],
    [],
    [],
    [
      {
        token: 'share',
        messageId: '<one@example.test>',
        messageIds: '["<one@example.test>", "<two@example.test>"]'
      }
    ],
    [row],
    [
      {
        token: 'thread-share',
        messageId: '<one@example.test>',
        messageIds: '["<one@example.test>", "<two@example.test>"]'
      }
    ],
    [row, { ...row, id: 8 }, { ...row, messageId: '<two@example.test>', id: 9 }],
    [],
    [
      {
        path: 'Archive',
        configId: 'primary',
        remotePath: 'Archive',
        name: 'Archive',
        delimiter: '/',
        specialUse: '\\Archive'
      }
    ]
  ]

  assert.equal((await listMessagesBySender('Inbox', 'ADA@example.test')).length, 1)
  assert.equal(await countMessagesBySender('Inbox', 'Ada <ada@example.test>'), 1)
  assert.equal((await searchMessagesByRegex('one')).length, 1)
  assert.match((await createShareToken(7))!, /^[0-9a-f-]{36}$/)
  assert.equal((await getMessageByShareToken('share'))?.id, 7)
  assert.deepEqual(
    (await getSharedMessagesByShareToken('thread-share')).map((message) => message.messageId),
    ['<one@example.test>', '<two@example.test>']
  )
  await markShareTokenAsRead('share')
  assert.equal(await moveMessage(row, 'archive'), 'Archive')
  assert.deepEqual(state.moves, [{ uid: 4, mailbox: 'Inbox', targetMailbox: 'Archive' }])
})

test('shows queued sends as Sent placeholders and resolves their compose detail', async () => {
  state.demoMode = false
  state.smtpConfigs = [{ id: 'smtp-1', from: 'Ada <ada@example.test>' }]
  const createdAt = new Date('2026-02-01T12:00:00Z')
  const job = {
    id: 13,
    payload: JSON.stringify({
      to: 'Bob <bob@example.test>',
      subject: 'Queued send',
      html: '<p>Hello Bob</p>',
      smtpServerId: 'smtp-1',
      fromName: 'Ada Lovelace',
      inReplyTo: '<parent@example.test>'
    }),
    status: 'pending',
    messageId: '<queued@example.test>',
    sentMailbox: 'Sent',
    placeholderActive: true,
    deliveredAt: null,
    openedAt: null,
    createdAt
  }
  state.queryResults = [[job], [], [{ value: 2 }], [{ value: 1 }], [job]]

  const messages = await listStoredMessages('Sent', 10)
  assert.deepEqual(
    messages.map(({ id, subject, sendStatus, from }) => ({ id, subject, sendStatus, from })),
    [
      {
        id: -13,
        subject: 'Queued send',
        sendStatus: 'sending',
        from: 'Ada Lovelace <ada@example.test>'
      }
    ]
  )
  assert.equal(await countStoredMessages('Sent'), 3)

  const detail = await getStoredMessageById(-13)
  assert.equal(detail?.textContent, 'Hello Bob')
  assert.equal(detail?.inReplyTo, '<parent@example.test>')
})

test('deletes expired orphaned messages and no-ops when requested rows are absent', async () => {
  state.demoMode = false
  state.queryResults = [[{ id: 1 }, { id: 2 }], [], []]

  assert.equal(await purgeOrphanedMessages(), 2)
  assert.equal(await snoozeMessages([99], null), 0)
  assert.equal(await markMessagesSeen([99], true), 0)
  assert.equal(state.calls.filter((call) => call.operation === 'delete').length, 1)
})

test('falls back to persisted sync and message mailbox paths when the catalog is empty', async () => {
  state.demoMode = false
  state.queryResults = [[], [{ path: 'Projects/2026' }], [{ path: 'Inbox' }]]

  assert.deepEqual(await getImapMailboxes(), [
    {
      path: 'Inbox',
      name: 'Inbox',
      delimiter: '/',
      specialUse: null
    },
    {
      path: 'Projects/2026',
      name: '2026',
      delimiter: '/',
      specialUse: null
    }
  ])
})

test('creates non-existing shares and falls back to a single share message after invalid IDs', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [{ messageId: row.messageId }],
    [],
    [],
    [],
    [],
    [{ token: 'fallback', messageId: row.messageId, messageIds: 'not json' }],
    [row, { ...row, id: 8 }]
  ]

  assert.match((await createShareToken(row.id))!, /^[0-9a-f-]{36}$/)
  assert.match(
    (await createThreadShareToken([row.messageId, '<two@example.test>']))!,
    /^[0-9a-f-]{36}$/
  )
  assert.deepEqual(
    (await getSharedMessagesByShareToken('fallback')).map((message) => message.id),
    [row.id]
  )
})

test('backfills PGP-hinted raw sources through mocked OpenPGP processing', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <pgp@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  state.queryResults = [[{ id: 42, messageId: '<pgp@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { openPgpSigned?: boolean } | undefined)?.openPgpSigned === true
    )
  )
})

test('replaces stored content when an OpenPGP backfill decrypts a message', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <encrypted@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const decryptedSource = Buffer.from(
    [
      'Message-ID: <encrypted@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Decrypted',
      '',
      'Plaintext body'
    ].join('\r\n')
  )
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.queryResults = [
    [{ id: 42, messageId: '<encrypted@example.test>', rawSource: source }],
    [],
    [],
    [{ id: 5 }],
    [],
    [],
    []
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { textContent?: string } | undefined)?.textContent === 'Plaintext body'
    )
  )
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { openPgpDecrypted?: boolean } | undefined)?.openPgpDecrypted === true
    )
  )
})

test('records OpenPGP backfill parsing failures without counting the message as processed', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <broken-pgp@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      ''
    ].join('\r\n')
  )
  state.processInboundOpenPgp.mockRejectedValueOnce(new Error('decryption failed'))
  state.queryResults = [[{ id: 42, messageId: '<broken-pgp@example.test>', rawSource: source }], []]

  assert.equal(await backfillOpenPgpFromWorker(), 0)
  const [operation, error, context] = state.logServerError.mock.calls[0] ?? []
  assert.equal(operation, 'mail.openpgp.backfill')
  assert.equal((error as Error).message, 'decryption failed')
  assert.deepEqual(context, { mailboxEntryId: 42 })
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { openPgpError?: string } | undefined)?.openPgpError === 'decryption failed'
    )
  )
})

test('records raw-source retry attempts for unavailable configurations and mailbox failures', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    mailboxOpen: vi.fn(async () => {
      throw new Error('mailbox unavailable')
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 1,
        messageId: '<missing-config@example.test>',
        mailbox: 'Old Inbox',
        uid: 1,
        uidValidity: 9,
        attempts: 0,
        configId: 'removed',
        remoteMailbox: 'Old Inbox'
      },
      {
        id: 2,
        messageId: '<failed-mailbox@example.test>',
        mailbox: 'Inbox',
        uid: 2,
        uidValidity: 9,
        attempts: 2,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ],
    [],
    []
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.deepEqual(connection.mailboxOpen.mock.calls, [['Inbox']])
  assert.deepEqual(
    state.calls
      .filter((call) => call.operation === 'update')
      .map((call) => (call.set as { rawSourceAttempts?: number }).rawSourceAttempts),
    [1, 3]
  )
  assert.deepEqual(state.logServerError.mock.calls[0]?.slice(0, 1), ['mail.raw-source.backfill'])
})

test('removes empty thread summaries and resolves archive and trash actions', async () => {
  state.demoMode = false
  const message = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date(),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [],
    [],
    [
      {
        path: 'Archive',
        configId: 'primary',
        remotePath: 'Archive',
        name: 'Archive',
        delimiter: '/',
        specialUse: '\\Archive'
      }
    ],
    [
      {
        path: 'Trash',
        configId: 'primary',
        remotePath: 'Trash',
        name: 'Trash',
        delimiter: '/',
        specialUse: '\\Trash'
      }
    ]
  ]

  await refreshThreadSummaries('Inbox', ['<thread@example.test>', '<thread@example.test>', ''])
  assert.equal(await moveMessage(message, 'archive'), 'Archive')
  assert.equal(await moveMessage(message, 'trash'), 'Trash')
  assert.deepEqual(state.moves, [
    { uid: 4, mailbox: 'Inbox', targetMailbox: 'Archive' },
    { uid: 4, mailbox: 'Inbox', targetMailbox: 'Trash' }
  ])
  assert.equal(state.calls.filter((call) => call.operation === 'delete').length, 1)
})

test('reports missing configuration and short-circuits unread views for always-read mailboxes', async () => {
  state.demoMode = false
  state.config = { missing: ['IMAP_HOST', 'IMAP_USER'] }
  state.queryResults = [[], []]

  assert.deepEqual(await getSyncSummary(), {
    syncing: false,
    configured: false,
    hasError: false,
    lastSyncedAt: null,
    errorMessage: null,
    progress: null
  })
  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: false,
    skipped: true,
    syncing: false,
    fetchedCount: 0,
    storedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    reason: 'Missing IMAP_HOST, IMAP_USER.'
  })
  assert.deepEqual(await listStoredMessages('Sent', 10, 0, true), [])
  assert.equal(await countStoredMessages('Sent', true), 0)
  assert.deepEqual(await listStoredThreads('Sent', 10, 0, true), [])
  assert.equal(await countStoredThreads('Sent', true), 0)
})

test('deduplicates persisted thread and search results while preserving representative rows', async () => {
  state.demoMode = false
  const sentRow = {
    id: 1,
    messageId: '<shared@example.test>',
    mailbox: 'Sent',
    uid: 3,
    flags: '[]',
    subject: 'Shared subject',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  const inboxCopy = { ...sentRow, id: 2, mailbox: 'Inbox', uid: 4 }
  const newer = {
    ...inboxCopy,
    id: 3,
    messageId: '<newer@example.test>',
    uid: 5,
    receivedAt: new Date('2026-01-03T00:00:00Z')
  }
  state.queryResults = [
    [sentRow],
    [inboxCopy, sentRow, newer],
    [inboxCopy, sentRow, newer],
    [{ value: 2 }]
  ]

  const singleMailbox = await getMessagesInMailboxesThread('<thread@example.test>', ['Sent'])
  assert.equal(singleMailbox[0]?.flags, '["\\\\Seen"]')

  const combined = await getMessagesInMailboxesThread('<thread@example.test>', ['Inbox', 'Sent'])
  assert.deepEqual(
    combined.map((row) => row.messageId),
    ['<shared@example.test>', '<newer@example.test>']
  )

  const search = await searchMessages('Shared subject', 10, 0)
  assert.deepEqual(
    search.map((row) => row.messageId),
    ['<shared@example.test>', '<newer@example.test>']
  )
  assert.equal(await countSearchMessages('Shared subject'), 2)
  assert.deepEqual(await searchMessages('   ', 10, 0), [])
  assert.equal(await countSearchMessages('   '), 0)
})

test('combines persisted mailbox thread counts without double-counting message copies', async () => {
  state.demoMode = false
  const inboxThread = {
    id: 1,
    messageId: '<shared@example.test>',
    mailbox: 'Inbox',
    uid: 5,
    flags: '[]',
    subject: 'Thread',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-03T00:00:00Z'),
    threadId: '<thread@example.test>',
    threadCount: 1,
    hasUnread: true,
    hasImportantUnread: false,
    hasThreadNote: false
  }
  const sentThread = { ...inboxThread, id: 2, mailbox: 'Sent', uid: 4, flags: '["\\\\Seen"]' }
  state.queryResults = [
    [],
    [],
    [inboxThread],
    [sentThread],
    [{ threadKey: '<thread@example.test>', value: 2 }],
    [{ value: 1 }],
    [{ value: 0 }],
    [{ value: 0 }]
  ]

  const threads = await listStoredThreadsInMailboxes(['Inbox', 'Sent'])
  assert.equal(threads.length, 1)
  assert.equal(threads[0]?.threadCount, 2)
  assert.equal(threads[0]?.hasUnread, true)
  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Sent']), 1)
})

test('applies persisted read changes through message wrappers and contains queue failures', async () => {
  state.demoMode = false
  const message = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    threadId: '<thread@example.test>'
  } as MailRow
  state.queryResults = [
    [{ messageId: message.messageId }],
    [{ ...message, threadKey: '<thread@example.test>' }],
    [],
    [],
    [
      {
        representativeMailboxEntryId: message.id,
        latestUid: message.uid,
        latestReceivedAt: new Date()
      }
    ],
    [{ value: 1 }],
    [],
    [{ messageId: message.messageId }],
    [{ ...message, flags: JSON.stringify(['\\Seen']), threadKey: '<thread@example.test>' }],
    [],
    [],
    [
      {
        representativeMailboxEntryId: message.id,
        latestUid: message.uid,
        latestReceivedAt: new Date()
      }
    ],
    [{ value: 1 }],
    [],
    new Error('read queue unavailable'),
    new Error('unread queue unavailable')
  ]

  await markMessageAsRead(message)
  await markMessageAsUnread({ ...message, flags: JSON.stringify(['\\Seen']) })
  await markMessageAsRead(message)
  await markMessageAsUnread(message)

  const jobTypes = state.calls
    .filter((call) => call.operation === 'insert' && Array.isArray(call.values))
    .flatMap((call) => (call.values as Array<{ type?: string }>).map((job) => job.type))
  assert.deepEqual(jobTypes, ['mark_read', 'mark_unread'])
  assert.deepEqual(state.dismissedNotifications, [[message.id]])
  assert.deepEqual(
    state.logServerError.mock.calls.map(([operation, error, context]) => ({
      operation,
      error: (error as Error).message,
      context
    })),
    [
      {
        operation: 'mail.markMessageAsRead',
        error: 'read queue unavailable',
        context: { messageId: 7, mailbox: 'Inbox', uid: 4 }
      },
      {
        operation: 'mail.markMessageAsUnread',
        error: 'unread queue unavailable',
        context: { messageId: 7, mailbox: 'Inbox', uid: 4 }
      }
    ]
  )
})

test('marks every unread message in a persisted mailbox as seen', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        path: 'Inbox',
        configId: 'primary',
        remotePath: 'Inbox',
        name: 'Inbox',
        delimiter: '/',
        specialUse: '\\Inbox'
      }
    ],
    [{ id: 7 }],
    [{ messageId: '<one@example.test>' }],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        threadKey: '<thread@example.test>'
      }
    ],
    [],
    [],
    [{ representativeMailboxEntryId: 7, latestUid: 4, latestReceivedAt: new Date() }],
    [{ value: 1 }],
    []
  ]

  assert.equal(await markMailboxMessagesSeen('inbox'), 1)
  assert.deepEqual(state.dismissedNotifications, [[7]])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        Array.isArray(call.values) &&
        (call.values as Array<{ type?: string }>)[0]?.type === 'mark_read'
    )
  )
})

test('propagates persisted thread lookup failures after recording performance context', async () => {
  state.demoMode = false
  state.queryResults = [new Error('thread lookup failed')]

  await assert.rejects(
    getMessagesInThread('<thread@example.test>', 'Inbox'),
    /thread lookup failed/
  )
  assert.equal(state.logServerError.mock.calls.length, 0)
})

test('contains push dismissal failures after a persisted message becomes read', async () => {
  state.demoMode = false
  const error = new Error('push service unavailable')
  state.dismissPush.mockRejectedValueOnce(error)
  state.queryResults = [
    [{ messageId: '<one@example.test>' }],
    [
      {
        id: 7,
        messageId: '<one@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        threadKey: '<thread@example.test>'
      }
    ],
    [],
    [],
    [{ representativeMailboxEntryId: 7, latestUid: 4, latestReceivedAt: new Date() }],
    [{ value: 1 }],
    []
  ]

  assert.equal(await markMessagesSeen([7], true), 1)
  assert.deepEqual(state.logServerError.mock.calls[0]?.slice(0, 3), [
    'push.dismissReadNotifications',
    error,
    { messageIds: [7] }
  ])
})

test('rejects an incomplete IMAP source batch without marking the mailbox synced', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (!query.source) {
        yield { uid: 1, envelope: { messageId: '<missing-source@example.test>' }, flags: new Set() }
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]

  await assert.rejects(runMailboxSyncOnce(), /Incomplete mailbox batch: stored 0 of 1 fetched/)
  assert.equal(lock.release.mock.calls.length, 1)
})

test('fails reconciliation when the selected mailbox disappears or changes UIDVALIDITY', async () => {
  for (const reconcileMailbox of [null, { uidValidity: 10n, highestModseq: 12n }]) {
    state.demoMode = false
    state.configs = [imapConfig]
    const syncLock = { release: vi.fn() }
    const reconcileLock = { release: vi.fn() }
    const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
    const syncConnection = {
      status: vi.fn(async () => ({ uidNext: 1, uidValidity: 9n, highestModseq: 12n })),
      getMailboxLock: vi.fn(async () => syncLock),
      mailbox: { uidValidity: 9n, uidNext: 1, highestModseq: 12n, usable: true },
      noop: vi.fn(async () => undefined)
    }
    const reconcileConnection = {
      getMailboxLock: vi.fn(async () => reconcileLock),
      mailbox: reconcileMailbox,
      capabilities: new Set<string>()
    }
    state.connections = [listConnection, syncConnection, reconcileConnection]

    await assert.rejects(
      runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set(['Inbox'])]]) }),
      reconcileMailbox
        ? /UIDVALIDITY changed while syncing Inbox/
        : /was not selected for reconciliation/
    )
    assert.equal(syncLock.release.mock.calls.length, 1)
    assert.equal(reconcileLock.release.mock.calls.length, 1)
  }
})

test('orders equally ranked IMAP mailboxes by name and path before applying mailbox scope', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = {
    list: vi.fn(async () => [
      { path: 'Projects/Zeta', name: 'Projects' },
      { path: 'Projects/Alpha', name: 'Projects' }
    ])
  }
  state.connections = [listConnection]

  assert.equal(
    await runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set<string>()]]) }),
    true
  )
  assert.equal(listConnection.list.mock.calls.length, 1)
})

test('does not rewrite an unchanged persisted IMAP mailbox catalog', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const mailbox = {
    path: 'Projects',
    configId: 'primary',
    remotePath: 'Projects',
    name: 'Projects',
    delimiter: '/',
    specialUse: null
  }
  state.queryResults = [[], [mailbox]]
  state.connections = [{ list: vi.fn(async () => [mailbox]) }]

  assert.equal(
    await runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set<string>()]]) }),
    true
  )
  assert.equal(state.connections.length, 0)
})

test('reports envelope fetch progress during a large incomplete IMAP batch', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 1001, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 1001, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) return
      for (let uid = 1; uid <= 1000; uid += 1) {
        yield { uid, envelope: { messageId: `<${uid}@example.test>` }, flags: new Set<string>() }
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]

  await assert.rejects(runMailboxSyncOnce(), /Incomplete mailbox batch: stored 0 of 1000 fetched/)
  assert.equal(lock.release.mock.calls.length, 1)
})

test('searches persisted mail with date, attachment, and fallback qualifiers', async () => {
  state.demoMode = false
  state.queryResults = [[]]

  assert.deepEqual(
    await searchMessages(
      'before:2026-02-01 after:2026-01-01 has:attachment label:important',
      10,
      0
    ),
    []
  )
})

test('marks unavailable, oversized, and omitted raw IMAP sources as checked', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* (_range: string) {
      yield { uid: 7 }
      yield { uid: 8, source: Buffer.alloc(25 * 1024 * 1024 + 1) }
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<unavailable@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      },
      {
        id: 8,
        messageId: '<large@example.test>',
        mailbox: 'Inbox',
        uid: 8,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      },
      {
        id: 9,
        messageId: '<missing@example.test>',
        mailbox: 'Inbox',
        uid: 9,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.deepEqual((connection.fetch.mock.calls as unknown as [string][])[0]?.[0], '7,8,9')
  const checkedIds = state.calls.filter(
    (call) =>
      call.operation === 'update' &&
      (call.set as { rawSourceCheckedAt?: Date } | undefined)?.rawSourceCheckedAt instanceof Date
  ).length
  assert.equal(checkedIds, 3)
})

test('reprocesses PGP sources after discovering a sender verification key', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <discovered-key@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const unknown = {
    signed: true,
    signatureStatus: 'unknown',
    signer: null,
    fingerprint: null,
    encrypted: false,
    decrypted: false,
    error: null,
    rawMessage: source
  }
  state.openPgpResults = [unknown, { ...unknown, signatureStatus: 'valid' }]
  state.lookupKeys = [{ getFingerprint: () => 'discovered' }]
  state.parsedAddresses = [{ email: 'ada@example.test' }]
  state.queryResults = [[{ id: 42, messageId: '<discovered-key@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 2)
  assert.equal(
    (state.processInboundOpenPgp.mock.calls[1]![0] as { verificationKeys: unknown[] })
      .verificationKeys.length,
    1
  )
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { openPgpSignatureStatus?: string } | undefined)?.openPgpSignatureStatus ===
          'valid'
    )
  )
})

test('delegates single-mailbox composed queries to persisted list and count operations', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>'
  }
  state.queryResults = [
    [],
    [row],
    [{ value: 1 }],
    [{ value: 0 }],
    [],
    [{ ...row, threadCount: 1, hasUnread: true, hasImportantUnread: false, hasThreadNote: false }],
    [{ value: 1 }],
    [{ value: 0 }]
  ]

  assert.equal((await listStoredMessagesInMailboxes(['Inbox'])).length, 1)
  assert.equal(await countStoredMessagesInMailboxes(['Inbox']), 1)
  assert.equal((await listStoredThreadsInMailboxes(['Inbox'])).length, 1)
  assert.equal(await countStoredThreadsInMailboxes(['Inbox']), 1)
})

test('counts composed persisted mail and threads with starred and pinned metadata filters', async () => {
  state.demoMode = false
  state.queryResults = [[{ value: 3 }], [{ value: 2 }], [{ value: 4 }], [{ value: 1 }]]

  assert.equal(await countStoredMessagesInMailboxes(['Inbox', 'Archive'], false, 'starred'), 3)
  assert.equal(await countStoredMessagesInMailboxes(['Inbox', 'Archive'], true, 'pinned'), 2)
  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Archive'], false, 'starred'), 4)
  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Archive'], true, 'pinned'), 1)
})

test('includes pending Sent placeholders in composed persisted thread counts', async () => {
  state.demoMode = false
  state.queryResults = [[{ value: 2 }], [{ value: 1 }], [{ value: 2 }]]

  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Sent']), 5)
})

test('records list failures and handles absent persisted share targets', async () => {
  state.demoMode = false
  state.queryResults = [new Error('message list failed'), new Error('thread list failed')]

  await assert.rejects(listStoredMessages('Inbox'), /message list failed/)
  await assert.rejects(listStoredThreads('Inbox'), /thread list failed/)
  assert.equal(state.logServerError.mock.calls.length, 0)

  state.queryResults = [
    [{ token: 'orphaned-share', messageId: '<missing@example.test>', messageIds: null }],
    [],
    [{ token: 'empty-share', messageId: null, messageIds: '[]' }]
  ]
  assert.equal(await getMessageByShareToken('orphaned-share'), null)
  assert.deepEqual(await getSharedMessagesByShareToken('empty-share'), [])
})

test('resolves persisted placeholder details through stored copies and inactive jobs', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<stored@example.test>',
    mailbox: 'Sent',
    uid: 4,
    flags: '[]',
    subject: 'Stored',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [{ id: 11, messageId: row.messageId, sentMailbox: 'Sent', placeholderActive: true }],
    [{ id: row.id }],
    [row],
    [
      {
        id: 12,
        messageId: '<inactive@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: false
      }
    ],
    []
  ]

  assert.equal((await getStoredMessageById(-11))?.id, row.id)
  assert.equal(await getStoredMessageById(-12), null)
})

test('reports an unsynced persisted mailbox as waiting for its first sync', async () => {
  state.demoMode = false
  state.config = imapConfig
  state.queryResults = [[], []]

  assert.deepEqual(await getMailboxSyncStatus('Projects'), {
    mailbox: 'Projects',
    configured: true,
    skipped: true,
    syncing: false,
    fetchedCount: 0,
    storedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    reason: 'Waiting for first sync.'
  })
})

test('resolves composed mailbox scopes from the mocked composed mailbox catalog', async () => {
  state.composedMailbox = {
    slug: 'all-work',
    mailboxPaths: ['Inbox', 'Projects']
  }

  assert.deepEqual(await resolveMailboxScope('all-work'), {
    path: 'all-work',
    paths: ['Inbox', 'Projects'],
    composedMailbox: state.composedMailbox
  })
})

test('repairs persisted thread keys and rebuilds thread summaries in one transaction', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        messageId: '<reply@example.test>',
        subject: 'Re: Project',
        inReplyTo: '<root@example.test>',
        references: null,
        threadKey: '<reply@example.test>',
        receivedAt: new Date('2026-01-02T00:00:00Z')
      },
      {
        messageId: '<root@example.test>',
        subject: 'Project',
        inReplyTo: null,
        references: null,
        threadKey: '<root@example.test>',
        receivedAt: new Date('2026-01-01T00:00:00Z')
      }
    ]
  ]

  await repairThreadKeys()

  assert.equal(state.transactionCalls.length, 6)
  assert.deepEqual(state.transactionCalls[1]?.[0], [
    { message_id: '<reply@example.test>', next_thread_key: '<root@example.test>' }
  ])
})

test('orders Sent placeholders with stored rows and counts composed mailbox placeholders', async () => {
  state.demoMode = false
  state.smtpConfigs = [{ id: 'smtp-1', from: 'Ada <ada@example.test>' }]
  state.queryResults = [
    [
      {
        id: 13,
        payload: JSON.stringify({
          to: 'Bob <bob@example.test>',
          subject: 'Queued',
          smtpServerId: 'smtp-1'
        }),
        status: 'pending',
        messageId: '<queued@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: true,
        deliveredAt: null,
        openedAt: null,
        createdAt: new Date('2026-02-02T00:00:00Z')
      }
    ],
    [
      {
        id: 7,
        messageId: '<stored@example.test>',
        mailbox: 'Sent',
        uid: 4,
        flags: '[]',
        subject: 'Stored',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: new Date('2026-02-01T00:00:00Z'),
        threadId: '<stored@example.test>',
        threadPinned: false
      }
    ],
    [{ value: 3 }],
    [{ value: 1 }],
    [{ value: 2 }]
  ]

  assert.deepEqual(
    (await listStoredMessages('Sent', 10)).map((message) => message.id),
    [-13, 7]
  )
  assert.equal(await countStoredMessagesInMailboxes(['Inbox', 'Sent']), 6)
})

test('resolves mailbox slugs from the persisted catalog when callers omit mailboxes', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        path: 'Projects',
        configId: 'primary',
        remotePath: 'Projects',
        name: 'Projects',
        delimiter: '/',
        specialUse: null
      }
    ]
  ]

  assert.equal(await resolveMailboxPath('projects'), 'Projects')
})

test('initializes an empty mailbox when its first IMAP status request reports no such message', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => {
      throw new Error('No such message')
    })
  }
  state.connections = [listConnection, syncConnection]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(state.invalidated, [{ configId: 'primary', connection: syncConnection }])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { historyComplete?: boolean } | undefined)?.historyComplete === true
    )
  )
})

test('persists and rethrows mailbox status failures', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => {
      throw new Error('IMAP unavailable')
    })
  }
  state.connections = [listConnection, syncConnection]

  await assert.rejects(runMailboxSyncOnce(), /IMAP unavailable/)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError === 'IMAP unavailable'
    )
  )
})

test('lists persisted threads without send placeholders and normalizes Sent read state', async () => {
  state.demoMode = false
  state.queryResults = [
    [],
    [
      {
        id: 7,
        messageId: '<sent@example.test>',
        mailbox: 'Sent',
        uid: 4,
        flags: '[]',
        subject: 'Sent message',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: null,
        threadId: '<thread@example.test>',
        threadCount: '1',
        hasUnread: true,
        hasImportantUnread: true,
        hasThreadNote: null
      }
    ]
  ]

  const threads = await listStoredThreads('Sent', 10, 4)

  assert.deepEqual(
    threads.map(({ receivedAt, hasUnread, hasImportantUnread, hasThreadNote }) => ({
      receivedAt,
      hasUnread,
      hasImportantUnread,
      hasThreadNote
    })),
    [{ receivedAt: null, hasUnread: false, hasImportantUnread: false, hasThreadNote: false }]
  )
})

test('rethrows persisted thread listing failures after loading send placeholders', async () => {
  state.demoMode = false
  state.queryResults = [[], new Error('thread list query failed')]

  await assert.rejects(listStoredThreads('Inbox'), /thread list query failed/)
})

test('updates cached IMAP mailbox entries without refetching their raw source', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      assert.equal(query.source, undefined)
      yield {
        uid: 7,
        envelope: { messageId: '<cached@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 6,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [{ id: 1, messageId: '<cached@example.test>', threadKey: '<cached@example.test>' }],
    [{ uid: 7, rawStored: true }],
    [],
    [],
    [],
    [{ representativeMailboxEntryId: 7, latestUid: 7, latestReceivedAt: new Date() }],
    [{ value: 1 }],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(
    syncConnection.fetch.mock.calls.map(([range]) => range),
    ['7:7']
  )
  assert.equal(lock.release.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { mailMessageId?: number; uid?: number } | undefined)?.mailMessageId ===
          1 &&
        (call.values as { uid?: number } | undefined)?.uid === 7
    )
  )
})

test('syncs mixed new and cached messages, then filters and notifies for the new message', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.pushError = new Error('push service unavailable')
  state.parsedAddresses = [{ email: 'ada@example.test' }]
  state.insertReturningResults = [[{ id: 1 }], [{ id: 3 }]]
  const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
    callback()
    return 1 as unknown as NodeJS.Timeout
  })
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <new@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: New message',
      '',
      'Body text'
    ].join('\r\n')
  )
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    usable: true,
    status: vi.fn(async () => ({ uidNext: 10, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 10, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 8, source }
        yield { uid: 7, source }
        return
      }
      yield {
        uid: 7,
        envelope: { messageId: '<new@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-02T00:00:00Z')
      }
      yield {
        uid: 8,
        envelope: { messageId: '<second@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
      yield {
        uid: 9,
        envelope: { messageId: '<cached@example.test>' },
        flags: new Set<string>(['\\Seen']),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => {
      throw new Error('keepalive unavailable')
    })
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 6,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date()
      }
    ],
    [],
    [],
    [{ id: 2, messageId: '<cached@example.test>', threadKey: '<cached@example.test>' }],
    [{ uid: 9, rawStored: true }],
    [],
    [],
    [{ id: 7, subject: 'New message', from: 'Ada <ada@example.test>' }],
    [{ count: 2 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  setIntervalSpy.mockRestore()
  assert.deepEqual(
    syncConnection.fetch.mock.calls.map(([range]) => range),
    ['7:9', '8,7']
  )
  assert.deepEqual(state.filteredMessageIds, [['<second@example.test>', '<new@example.test>']])
  assert.equal(state.upsertContacts.mock.calls.length, 2)
  assert.deepEqual(state.upsertContacts.mock.calls[1], [
    [
      {
        email: 'ada@example.test',
        source: 'auto',
        useCount: 1,
        lastUsedAt: new Date('2026-01-02T00:00:00Z')
      }
    ]
  ])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { messageId?: string; mailMessageId?: number } | undefined)?.messageId ===
          '<cached@example.test>' &&
        (call.values as { mailMessageId?: number } | undefined)?.mailMessageId === 2
    )
  )
  assert.equal(lock.release.mock.calls.length, 1)
})

test('updates a changed persisted mailbox catalog row before using the STATUS fast path', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = {
    list: vi.fn(async () => [
      { path: 'Inbox', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox' }
    ])
  }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [
      {
        path: 'Inbox',
        configId: 'primary',
        remotePath: 'Inbox',
        name: 'Old Inbox',
        delimiter: '/',
        specialUse: '\\Inbox'
      }
    ],
    [],
    [
      {
        lastUid: 7,
        uidValidity: 9,
        highestModseq: 12n,
        lastReconciledAt: new Date(),
        historyComplete: true,
        lastSyncedAt: null,
        lastError: null
      }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { name?: string } | undefined)?.name === 'Inbox'
    )
  )
  assert.equal(syncConnection.status.mock.calls.length, 1)
  assert.equal(lock.release.mock.calls.length, 0)
})

test('resolves a referenced thread key while replacing decrypted OpenPGP content', async () => {
  state.demoMode = false
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  const decryptedSource = Buffer.from(
    'Message-ID: <reply@example.test>\r\nIn-Reply-To: <root@example.test>\r\n\r\nPlaintext body'
  )
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.insertReturningResults = [[{ id: 5 }]]
  state.queryResults = [
    [{ id: 42, messageId: '<reply@example.test>', rawSource: source }],
    [{ rawSource: source }],
    [{ messageId: '<root@example.test>', threadKey: '<root@example.test>' }]
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { threadKey?: string } | undefined)?.threadKey === '<root@example.test>'
    )
  )
})

test('replaces OpenPGP content only when all stored raw copies match', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <encrypted-copies@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const decryptedSource = Buffer.from(
    [
      'Message-ID: <encrypted-copies@example.test>',
      'Subject: Decrypted copies',
      '',
      'Plaintext body'
    ].join('\r\n')
  )
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.queryResults = [
    [{ id: 42, messageId: '<encrypted-copies@example.test>', rawSource: source }],
    [{ rawSource: source }, { rawSource: source }],
    [],
    [{ id: 5 }],
    [],
    [],
    []
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { textContent?: string } | undefined)?.textContent === 'Plaintext body'
    )
  )
})

test('returns sync edge states without starting an IMAP connection', async () => {
  state.demoMode = false
  state.config = imapConfig
  state.configs = []
  state.queryResults = [
    [{ isSyncing: true, activeMailbox: 'Inbox', activeStored: 1, activeTotal: 3, lastError: null }],
    []
  ]

  assert.equal(await getMailboxSyncPollMs(), null)
  assert.equal(await runMailboxSyncOnce(), false)
  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: true,
    skipped: true,
    syncing: true,
    fetchedCount: 0,
    storedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    reason: 'Background sync in progress.'
  })
})

test('keeps already-correct persisted thread keys out of the repair transaction', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        messageId: '<root@example.test>',
        subject: 'Project',
        inReplyTo: null,
        references: null,
        threadKey: '<root@example.test>',
        receivedAt: new Date('2026-01-01T00:00:00Z')
      }
    ]
  ]

  await repairThreadKeys()

  assert.deepEqual(state.transactionCalls, [])
})

test('filters shared thread targets and counts read shares through parsed and fallback IDs', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [{ token: 'thread-share', messageId: null, messageIds: '["<one@example.test>", 7]' }],
    [row, { ...row, id: 8 }, { ...row, id: 9, messageId: '<two@example.test>' }],
    [
      { messageId: '<one@example.test>', messageIds: '["<one@example.test>", 7]' },
      { messageId: '<one@example.test>', messageIds: 'invalid json' },
      { messageId: '<one@example.test>', messageIds: '["<other@example.test>"]' },
      { messageId: '<one@example.test>', messageIds: null }
    ]
  ]

  assert.deepEqual(
    (await getSharedMessagesByShareToken('thread-share')).map((message) => message.messageId),
    ['<one@example.test>', '<two@example.test>']
  )
  assert.equal(await countSharedMessageReads('<one@example.test>'), 4)
})

test('records share reads and does not queue moves without a distinct target mailbox', async () => {
  state.demoMode = false
  const message = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]'
  } as MailRow
  state.queryResults = [
    [],
    [],
    [],
    [
      {
        path: 'Inbox',
        configId: 'primary',
        remotePath: 'Inbox',
        name: 'Inbox',
        delimiter: '/',
        specialUse: '\\Inbox'
      }
    ]
  ]

  await markShareTokenAsRead('share')
  assert.equal(await moveMessage(message, 'archive'), null)
  assert.equal(await moveMessage(message, 'inbox'), null)
  assert.equal(state.moves.length, 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { readAt?: Date } | undefined)?.readAt instanceof Date
    )
  )
})

test('maps queued Sent placeholders into thread rows', async () => {
  state.demoMode = false
  state.smtpConfigs = [{ id: 'smtp-1', from: 'Ada <ada@example.test>' }]
  state.queryResults = [
    [
      {
        id: 13,
        payload: JSON.stringify({
          to: 'Bob <bob@example.test>',
          subject: 'Queued thread',
          smtpServerId: 'smtp-1'
        }),
        status: 'pending',
        messageId: '<queued-thread@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: true,
        deliveredAt: null,
        openedAt: null,
        createdAt: new Date('2026-02-02T00:00:00Z')
      }
    ],
    []
  ]

  const threads = await listStoredThreads('Sent', 10)

  assert.deepEqual(
    threads.map(({ id, threadId, threadCount, hasUnread, hasImportantUnread }) => ({
      id,
      threadId,
      threadCount,
      hasUnread,
      hasImportantUnread
    })),
    [
      {
        id: -13,
        threadId: '<queued-thread@example.test>',
        threadCount: 1,
        hasUnread: false,
        hasImportantUnread: false
      }
    ]
  )
})

test('records database list failures after metadata filters bypass placeholder loading', async () => {
  state.demoMode = false
  state.queryResults = [new Error('message list failed'), new Error('thread list failed')]

  await assert.rejects(listStoredMessages('Inbox', 10, 0, false, 'starred'), /message list failed/)
  await assert.rejects(listStoredThreads('Inbox', 10, 0, false, 'pinned'), /thread list failed/)
})

test('skips malformed Sent placeholders and uses persisted fallback values', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        id: 1,
        payload: 'not json',
        status: 'pending',
        messageId: '<bad@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: true,
        deliveredAt: null,
        openedAt: null,
        createdAt: new Date()
      }
    ],
    [],
    [],
    [{ value: 0 }],
    [],
    [],
    [{ value: 0 }],
    []
  ]

  assert.deepEqual(await listStoredMessages('Sent'), [])
  assert.equal(await countStoredMessages('Inbox'), 0)
  assert.deepEqual(await listStoredThreads('Sent'), [])
  assert.equal(await countStoredThreads('Inbox'), 0)
})

test('handles null persisted dates, unread threads, and empty composed thread results', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<one@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'One',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: null,
    threadId: '<thread@example.test>',
    threadCount: 1,
    hasUnread: true,
    hasImportantUnread: false,
    hasThreadNote: false
  }
  state.queryResults = [[row], [row], [{ value: 0 }], [row], [{ value: 0 }]]

  assert.equal((await listStoredMessages('Inbox'))[0]?.receivedAt, null)
  assert.equal((await listMessagesBySender('Inbox', 'ada@example.test'))[0]?.receivedAt, null)
  assert.equal((await listStoredThreads('Inbox', 10, 0, true)).length, 1)
  assert.equal(await countStoredThreads('Inbox', true), 0)
})

test('returns an empty persisted composed thread view without querying counts', async () => {
  state.demoMode = false
  state.queryResults = [[], [], [], []]

  assert.deepEqual(await listStoredThreadsInMailboxes(['Inbox', 'Archive']), [])
})

test('treats qualifier-only searches and unchanged read state as no-ops', async () => {
  state.demoMode = false
  state.queryResults = [
    [],
    [{ messageId: '<seen@example.test>' }],
    [
      {
        id: 7,
        messageId: '<seen@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '["\\\\Seen"]',
        threadKey: '<thread@example.test>'
      }
    ]
  ]

  assert.deepEqual(
    await searchMessages('before:not-a-date after:not-a-date from: to: subject: has:other', 10, 0),
    []
  )
  assert.equal(await countSearchMessages('before:not-a-date after:not-a-date'), 0)
  assert.equal(await markMessagesSeen([7], true), 0)
})

test('handles empty composed scopes and missing persisted share records', async () => {
  state.demoMode = false
  state.composedMailbox = { slug: 'empty', mailboxPaths: [] }
  state.queryResults = [[], [], [], []]

  assert.equal(await markMailboxMessagesSeen('empty'), 0)
  assert.equal(await createShareToken(7), null)
  assert.equal(await createThreadShareToken(null as unknown as string[]), null)
  assert.equal(await getMessageByShareToken('missing'), null)
  assert.deepEqual(await getSharedMessagesByShareToken('missing'), [])
})

test('returns no persisted placeholder when its job or payload target is unavailable', async () => {
  state.demoMode = false
  state.queryResults = [
    [],
    [{ id: 2, messageId: null, sentMailbox: null, placeholderActive: true }]
  ]

  assert.equal(await getStoredMessageById(-1), null)
  assert.equal(await getStoredMessageById(-2), null)
})

test('logs slow thread-summary refreshes after rebuilding a persisted summary', async () => {
  state.demoMode = false
  state.queryResults = [
    [{ representativeMailboxEntryId: 7, latestUid: 4, latestReceivedAt: new Date() }],
    [{ value: 1 }]
  ]
  const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(100)

  await refreshThreadSummaries('Inbox', ['<thread@example.test>'])

  now.mockRestore()
})

test('continues raw-source backfill when OpenPGP parsing fails', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const source = Buffer.from(
    [
      'Message-ID: <parse-failure@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* (_range: string) {
      yield { uid: 7, source }
    })
  }
  state.connections = [connection]
  state.processInboundOpenPgp.mockRejectedValueOnce(new Error('PGP parser unavailable'))
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<parse-failure@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 1)
  assert.deepEqual(state.logServerError.mock.calls[0]?.slice(0, 1), [
    'mail.raw-source.parse-authentication'
  ])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSource?: Buffer } | undefined)?.rawSource?.equals(source)
    )
  )
})

test('handles malformed attached PGP public keys without failing the OpenPGP backfill', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <invalid-key@example.test>',
      'Content-Type: multipart/mixed; boundary="key"',
      '',
      '--key',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1',
      '--key',
      'Content-Type: application/pgp-keys',
      'Content-Disposition: attachment; filename="key.asc"',
      '',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      'not a key',
      '-----END PGP PUBLIC KEY BLOCK-----',
      '--key--'
    ].join('\r\n')
  )
  state.queryResults = [[{ id: 7, messageId: '<invalid-key@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 1)
  assert.deepEqual(
    (state.processInboundOpenPgp.mock.calls[0]![0] as { verificationKeys: unknown[] })
      .verificationKeys,
    []
  )
})

test('resets a mailbox cache when IMAP UIDVALIDITY changes', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 1, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 1, highestModseq: 12n, usable: true },
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 8,
        highestModseq: 11n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(lock.release.mock.calls.length, 1)
  assert.equal(state.calls.filter((call) => call.operation === 'delete').length, 3)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { uidValidity?: number } | undefined)?.uidValidity === 9
    )
  )
})

test('reports persisted runtime and mailbox failures in sync status summaries', async () => {
  state.demoMode = false
  state.config = imapConfig
  const now = new Date('2026-02-01T12:00:00Z')
  vi.useFakeTimers()
  vi.setSystemTime(now)
  state.queryResults = [
    [
      {
        isSyncing: false,
        activeMailbox: null,
        activeStored: 0,
        activeTotal: 0,
        lastError: 'worker stopped'
      }
    ],
    [
      {
        mailbox: 'Archive',
        lastSyncedAt: new Date('2026-02-01T11:00:00Z'),
        lastError: 'archive failed'
      },
      {
        mailbox: 'Inbox',
        lastSyncedAt: new Date('2026-02-01T10:00:00Z'),
        lastError: 'inbox failed'
      }
    ],
    [{ isSyncing: false, activeMailbox: null, activeStored: 0, activeTotal: 0, lastError: null }],
    [
      {
        lastFetchedCount: 2,
        lastStoredCount: 1,
        lastSyncedAt: new Date('2026-02-01T10:00:00Z'),
        lastError: 'inbox failed'
      }
    ]
  ]

  assert.deepEqual(await getSyncSummary(), {
    syncing: false,
    configured: true,
    hasError: true,
    lastSyncedAt: '2026-02-01T11:00:00.000Z',
    errorMessage: 'worker stopped',
    progress: null
  })
  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: true,
    skipped: false,
    syncing: false,
    fetchedCount: 2,
    storedCount: 1,
    lastSyncedAt: '2026-02-01T10:00:00.000Z',
    lastError: 'inbox failed',
    reason: 'Mailbox sync failed.'
  })
})

test('reconciles completed read jobs against remote flags and keeps pending jobs protected', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const syncLock = { release: vi.fn() }
  const reconcileLock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 1, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => syncLock),
    mailbox: { uidValidity: 9n, uidNext: 1, highestModseq: 12n, usable: true },
    noop: vi.fn(async () => undefined)
  }
  const reconcileConnection = {
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set<string>(),
    search: vi.fn(async () => [1, 2]),
    fetch: vi.fn(async function* (range: string) {
      if (range === '1:2') yield { uid: 1, flags: new Set(['\\Seen']) }
      if (range === '2') yield { uid: 2, flags: new Set(['\\Seen']) }
    })
  }
  state.connections = [listConnection, syncConnection, reconcileConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: null,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [
      { id: 10, uid: 1, flags: '[]', threadKey: '<thread@example.test>' },
      { id: 11, uid: 3, flags: '[]', threadKey: '<protected@example.test>' },
      { id: 12, uid: 5, flags: '[]', threadKey: '<removed@example.test>' }
    ],
    [
      { id: 1, uid: 1, type: 'mark_read', status: 'done' },
      { id: 2, uid: 2, type: 'mark_unread', status: 'done' },
      { id: 3, uid: 3, type: 'mark_read', status: 'pending' },
      { id: 4, uid: 4, type: 'mark_read', status: 'done' }
    ],
    [],
    [],
    [],
    [{ id: 10 }]
  ]

  assert.equal(
    await runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set(['Inbox'])]]) }),
    true
  )
  assert.deepEqual(
    reconcileConnection.fetch.mock.calls.map(([range]) => range),
    ['1:2', '2']
  )
  assert.deepEqual(state.dismissedNotifications, [[10]])
  assert.equal(syncLock.release.mock.calls.length, 1)
  assert.equal(reconcileLock.release.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { status?: string; attemptCount?: number } | undefined)?.status ===
          'pending' &&
        (call.set as { attemptCount?: number } | undefined)?.attemptCount === 0
    )
  )
  assert.ok(state.calls.filter((call) => call.operation === 'delete').length >= 1)
})

test('ignores raw-source responses for UIDs outside the pending backfill set', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* (_range: string) {
      yield { uid: 99, source: Buffer.from('unexpected source') }
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<pending@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSourceCheckedAt?: Date } | undefined)?.rawSourceCheckedAt instanceof Date
    )
  )
})

test('skips configured accounts outside a targeted mailbox sync scope', async () => {
  state.demoMode = false
  state.configs = [imapConfig, { ...imapConfig, id: 'secondary', name: 'Secondary' }]

  assert.equal(
    await runMailboxSyncOnce({ mailboxes: new Map([['unknown-account', new Set(['Inbox'])]]) }),
    true
  )
  assert.equal(state.connections.length, 0)
  assert.equal(state.calls.length, 0)
})

test('stores new message attachments and sanitizes PostgreSQL text during IMAP sync', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.insertReturningResults = [[{ id: 1 }]]
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <attachment@example.test>',
      'From: ada@example.test\0 <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Attachment\0 message',
      'Content-Type: multipart/mixed; boundary="attachment"',
      '',
      '--attachment',
      'Content-Type: text/plain',
      '',
      'Body\0 text',
      '--attachment',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename="notes\0.txt"',
      '',
      'Attached text',
      '--attachment--'
    ].join('\r\n')
  )
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 1, source }
        return
      }
      yield {
        uid: 1,
        envelope: { messageId: '<attachment@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  const message = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { subject?: string; textContent?: string } | undefined)?.subject ===
        'Attachment message'
  )
  assert.ok(message)
  assert.equal((message.values as { textContent?: string }).textContent, 'Body text')
  const attachment = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { filename?: string } | undefined)?.filename === 'notes.txt'
  )
  assert.ok(attachment)
  assert.equal((attachment.values as { content?: Buffer }).content?.toString(), 'Attached text')
})

test('records a fallback message for non-Error IMAP failures', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    list: vi.fn(async () => {
      throw 503
    })
  }
  state.connections = [connection]

  await assert.rejects(runMailboxSyncOnce(), (error) => error === 503)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError === 'Unknown IMAP sync error'
    )
  )
})

test('handles empty backfill queues and empty IMAP mailbox catalogs without writes', async () => {
  state.demoMode = false

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)

  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => []) }
  state.connections = [listConnection]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(listConnection.list.mock.calls.length, 1)
  assert.deepEqual(
    state.calls.filter(
      (call) => call.operation === 'insert' && 'path' in (call.values as Record<string, unknown>)
    ),
    []
  )
})

test('sorts each standard mailbox role before applying an empty sync scope', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = {
    list: vi.fn(async () => [
      { path: 'Trash', name: 'Trash' },
      { path: 'Junk', name: 'Junk' },
      { path: 'Archive', name: 'Archive' },
      { path: 'Drafts', name: 'Drafts' },
      { path: 'Sent', name: 'Sent' },
      { path: 'Inbox', name: 'Inbox' }
    ])
  }
  state.connections = [listConnection]

  assert.equal(
    await runMailboxSyncOnce({ mailboxes: new Map([['primary', new Set<string>()]]) }),
    true
  )
  assert.equal(listConnection.list.mock.calls.length, 1)
})

test('returns no-op results for empty unread mailbox updates and reuses active shares', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        path: 'Inbox',
        configId: 'primary',
        remotePath: 'Inbox',
        name: 'Inbox',
        delimiter: '/',
        specialUse: '\\Inbox'
      }
    ],
    [],
    [{ messageId: '<shared@example.test>' }],
    [{ token: 'active-share' }]
  ]

  assert.equal(await markMailboxMessagesSeen('inbox'), 0)
  assert.equal(await createShareToken(7), 'active-share')
  assert.equal(
    state.calls.some(
      (call) =>
        call.operation === 'insert' && (call.values as { token?: string })?.token !== undefined
    ),
    false
  )
})

test('covers empty and non-Error OpenPGP backfill rows', async () => {
  state.demoMode = false
  state.queryResults = [[{ id: 1, messageId: '<empty@example.test>', rawSource: null }]]

  assert.equal(await backfillOpenPgpFromWorker(), 0)
  assert.equal(state.calls.filter((call) => call.operation === 'update').length, 0)

  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  state.processInboundOpenPgp.mockRejectedValueOnce(503)
  state.queryResults = [[{ id: 2, messageId: '<failed@example.test>', rawSource: source }], []]

  assert.equal(await backfillOpenPgpFromWorker(), 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { openPgpError?: string } | undefined)?.openPgpError === '503'
    )
  )
})

test('marks raw-source rows unavailable when IMAP opens without UIDVALIDITY', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = { mailboxOpen: vi.fn(async () => undefined) }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 42,
        messageId: '<message@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSourceAttempts?: number } | undefined)?.rawSourceAttempts === 1
    )
  )
})

test('keeps an empty persisted mailbox path when deriving catalog fallbacks', async () => {
  state.demoMode = false
  state.queryResults = [[], [{ path: '' }], []]

  assert.deepEqual(await getImapMailboxes(), [
    { path: '', name: '', delimiter: '/', specialUse: null }
  ])
})

test('preserves composed thread rows without a thread key', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<unthreaded@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'Unthreaded',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date('2026-01-02T00:00:00Z'),
    threadId: null,
    threadCount: 1,
    hasUnread: false,
    hasImportantUnread: false,
    hasThreadNote: false
  }
  state.queryResults = [[], [], [row], [], []]

  const threads = await listStoredThreadsInMailboxes(['Inbox', 'Archive'])

  assert.deepEqual(
    threads.map(({ messageId, threadId, threadCount }) => ({ messageId, threadId, threadCount })),
    [{ messageId: '<unthreaded@example.test>', threadId: null, threadCount: 1 }]
  )
})

test('accepts recipient search qualifiers in persisted searches', async () => {
  state.demoMode = false
  state.queryResults = [[]]

  assert.deepEqual(await searchMessages('to:bob@example.test', 10, 0), [])
})

test('stores a hundred new IMAP messages in one source batch', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.insertReturningResults = Array.from({ length: 100 }, (_, index) => [{ id: index + 1 }])
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'From: ada@example.test <ADA@EXAMPLE.TEST>',
      'To: Bob <bob@example.test>',
      'Subject: Batch message',
      'References: <parent@example.test>',
      '',
      'Body text'
    ].join('\r\n')
  )
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 101, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 101, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      for (let uid = 1; uid <= 100; uid += 1) {
        if (query.source) yield { uid, source }
        else
          yield { uid, envelope: { messageId: `<${uid}@example.test>` }, flags: new Set<string>() }
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  let now = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 100))
  assert.equal(await runMailboxSyncOnce(), true)
  clock.mockRestore()
  assert.deepEqual(
    syncConnection.fetch.mock.calls.map(([range]) => range),
    [
      '1:100',
      '100,99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81,80,79,78,77,76,75,74,73,72,71,70,69,68,67,66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36,35,34,33,32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1'
    ]
  )
  assert.equal(lock.release.mock.calls.length, 1)
  assert.equal(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { mailbox?: string; uid?: number } | undefined)?.mailbox === 'Inbox' &&
        (call.values as { uid?: number } | undefined)?.uid !== undefined
    ).length,
    100
  )
})

test('updates five hundred cached IMAP mailbox entries without downloading sources', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const rows = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    messageId: `<${index + 1}@example.test>`,
    threadKey: `<thread-${index + 1}@example.test>`
  }))
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 501, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 501, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string) {
      for (let uid = 1; uid <= 500; uid += 1) {
        yield { uid, envelope: { messageId: `<${uid}@example.test>` }, flags: new Set<string>() }
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    rows,
    rows.map((_row, index) => ({ uid: index + 1, rawStored: true })),
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(
    syncConnection.fetch.mock.calls.map(([range]) => range),
    ['1:500']
  )
  assert.equal(lock.release.mock.calls.length, 1)
  assert.equal(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { mailbox?: string; uid?: number } | undefined)?.mailbox === 'Inbox' &&
        (call.values as { uid?: number } | undefined)?.uid !== undefined
    ).length,
    500
  )
})

test('does not replace decrypted content when another stored copy has different raw source', async () => {
  state.demoMode = false
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: Buffer.from('Subject: Decrypted\r\n\r\nPlaintext body')
  }
  state.queryResults = [
    [{ id: 42, messageId: '<different-copy@example.test>', rawSource: source }],
    [{ rawSource: source }, { rawSource: Buffer.from('different') }]
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { textContent?: string } | undefined)?.textContent === 'Plaintext body'
    ),
    false
  )
})

test('re-verifies decrypted content using a public key attached to the plaintext', async () => {
  state.demoMode = false
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  const decryptedSource = Buffer.from(
    [
      'From: Ada <ada@example.test>',
      'Content-Type: multipart/mixed; boundary="key"',
      '',
      '--key',
      'Content-Type: text/plain',
      '',
      'Plaintext body',
      '--key',
      'Content-Type: application/pgp-keys',
      'Content-Disposition: attachment; filename="key.asc"',
      '',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      'test key',
      '-----END PGP PUBLIC KEY BLOCK-----',
      '--key--'
    ].join('\r\n')
  )
  const decrypted = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.openPgpResults = [decrypted, { ...decrypted, signatureStatus: 'valid' }]
  state.readKey.mockResolvedValue({ getFingerprint: () => 'plaintext-key' })
  state.queryResults = [
    [{ id: 42, messageId: '<plaintext-key@example.test>', rawSource: source }],
    [{ rawSource: source }],
    [],
    [{ id: 5 }],
    [],
    [],
    []
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 2)
  const secondPass = state.processInboundOpenPgp.mock.calls[1]?.[0]
  assert.ok(secondPass)
  assert.equal((secondPass as { verificationKeys: unknown[] }).verificationKeys.length, 1)
})

test('persists meaningful IMAP response text instead of a generic command failure', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => {
      throw Object.assign(new Error('Command failed: STATUS'), {
        responseText: 'Mailbox permission denied',
        command: 'STATUS Inbox',
        code: 'NO',
        cause: 'nested failure'
      })
    })
  }
  state.connections = [listConnection, syncConnection]

  await assert.rejects(runMailboxSyncOnce(), /Command failed: STATUS/)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError ===
          'Mailbox permission denied'
    )
  )
})

test('uses wildcard trusted auth servers and passes detached PGP signatures to verification', async () => {
  state.demoMode = false
  state.trustedAuthservIds = '*.example.test'
  const source = Buffer.from(
    [
      'Message-ID: <signed@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: multipart/mixed; boundary="signed"',
      '',
      '--signed',
      'Content-Type: text/plain',
      '',
      'Signed body',
      '--signed',
      'Content-Type: application/pgp-signature',
      'Content-Disposition: attachment; filename="signature.asc"',
      '',
      'signature',
      '--signed--'
    ].join('\r\n')
  )
  state.publicKeys = [{ getFingerprint: () => 'TRUSTED-FINGERPRINT' }]
  state.queryResults = [
    [{ id: 7, messageId: '<signed@example.test>', rawSource: source }],
    [],
    [
      {
        id: 8,
        messageId: '<sender@example.test>',
        mailbox: 'Inbox',
        uid: 1,
        flags: '[]',
        receivedAt: new Date(),
        authservId: 'mail.example.test'
      }
    ]
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(
    (
      state.processInboundOpenPgp.mock.calls[0]![0] as { detachedSignatures: Buffer[] }
    ).detachedSignatures[0]?.toString(),
    'signature'
  )
  assert.deepEqual(
    (state.processInboundOpenPgp.mock.calls[0]![0] as { trustedFingerprints: Set<string> })
      .trustedFingerprints,
    new Set(['trusted-fingerprint'])
  )
  assert.equal(
    (
      (await listMessagesBySender('Inbox', 'sender@example.test'))[0] as
        | (MailRow & { authenticationTrusted?: boolean })
        | undefined
    )?.authenticationTrusted,
    true
  )
})

test('replaces content while backfilling a transformed raw OpenPGP source', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  const transformed = Buffer.from('Subject: Replaced\r\n\r\nPlaintext body')
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: transformed
  }
  state.insertReturningResults = [[]]
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* () {
      yield { uid: 7, source }
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<replace@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ],
    [{ rawSource: source }],
    [{ id: 11 }]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { textContent?: string } | undefined)?.textContent === 'Plaintext body'
    )
  )
})

test('reports a persisted mailbox with no completed sync and distinguishes exact auth trust', async () => {
  state.demoMode = false
  state.config = imapConfig
  state.trustedAuthservIds = 'mx.example.test'
  state.queryResults = [
    [{ isSyncing: false, activeMailbox: null, activeStored: 0, activeTotal: 0, lastError: null }],
    [
      {
        lastFetchedCount: 0,
        lastStoredCount: 0,
        lastSyncedAt: null,
        lastError: null
      }
    ],
    [
      {
        id: 7,
        messageId: '<untrusted@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'Untrusted',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: null,
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null,
        replyTo: null,
        inReplyTo: null,
        references: null,
        authservId: 'other.example.test'
      }
    ],
    [
      {
        id: 8,
        messageId: '<trusted@example.test>',
        mailbox: 'Inbox',
        uid: 5,
        flags: '[]',
        subject: 'Trusted',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: null,
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null,
        replyTo: null,
        inReplyTo: null,
        references: null,
        authservId: ' MX.EXAMPLE.TEST '
      }
    ]
  ]

  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: true,
    skipped: false,
    syncing: false,
    fetchedCount: 0,
    storedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    reason: undefined
  })
  assert.equal(
    (
      (await listMessagesBySender('Inbox', 'ada@example.test'))[0] as
        | (MailRow & { authenticationTrusted?: boolean })
        | undefined
    )?.authenticationTrusted,
    false
  )
  assert.equal(
    (
      (await listMessagesBySender('Inbox', 'ada@example.test'))[0] as
        | (MailRow & { authenticationTrusted?: boolean })
        | undefined
    )?.authenticationTrusted,
    true
  )
})

test('marks pending raw sources checked when IMAP omits their UID', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9 },
    fetch: vi.fn(async function* () {
      yield { source: Buffer.from('source without UID') }
    })
  }
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 7,
        messageId: '<missing-uid@example.test>',
        mailbox: 'Inbox',
        uid: 7,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ]
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 0)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { rawSourceCheckedAt?: Date } | undefined)?.rawSourceCheckedAt instanceof Date
    )
  )
})

test('reports runtime and inbox sync errors with the appropriate persisted status reasons', async () => {
  state.demoMode = false
  state.config = imapConfig
  const syncedAt = new Date('2026-01-01T12:00:00Z')
  state.queryResults = [
    [
      {
        isSyncing: false,
        activeMailbox: null,
        activeStored: 0,
        activeTotal: 0,
        lastError: 'worker stopped'
      }
    ],
    [
      { mailbox: 'Archive', lastSyncedAt: syncedAt, lastError: null },
      {
        mailbox: 'Inbox',
        lastSyncedAt: new Date('2026-01-01T11:00:00Z'),
        lastError: 'inbox failed'
      }
    ],
    [{ isSyncing: true, activeMailbox: 'Inbox' }],
    [{ lastSyncedAt: null, lastFetchedCount: 0, lastStoredCount: 0, lastError: 'failed' }],
    [{ isSyncing: false, activeMailbox: null }],
    [{ lastSyncedAt: null, lastFetchedCount: 0, lastStoredCount: 0, lastError: 'failed' }]
  ]

  assert.deepEqual(await getSyncSummary(), {
    syncing: false,
    configured: true,
    hasError: true,
    lastSyncedAt: '2026-01-01T12:00:00.000Z',
    errorMessage: 'worker stopped',
    progress: null
  })
  assert.equal((await getMailboxSyncStatus('Inbox')).reason, 'Background sync in progress.')
  assert.equal((await getMailboxSyncStatus('Inbox')).reason, 'Mailbox sync failed.')
})

test('handles placeholder and share payload fallbacks without persisted messages', async () => {
  state.demoMode = false
  state.queryResults = [
    [{ id: 19, messageId: null, sentMailbox: null, placeholderActive: true }],
    [{ token: 'object-ids', messageId: '<fallback@example.test>', messageIds: '[1,{}]' }],
    [
      {
        id: 7,
        messageId: '<fallback@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        flags: '[]',
        subject: 'Fallback',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: null,
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null,
        replyTo: null,
        inReplyTo: null,
        references: null
      }
    ],
    [
      { messageId: '<fallback@example.test>', messageIds: 'not json' },
      { messageId: '<other@example.test>', messageIds: '["<fallback@example.test>", 1]' }
    ]
  ]

  assert.equal(await getStoredMessageById(-19), null)
  assert.deepEqual(
    (await getSharedMessagesByShareToken('object-ids')).map((message) => message.messageId),
    ['<fallback@example.test>']
  )
  assert.equal(await countSharedMessageReads('<fallback@example.test>'), 2)
})

test('does not queue moves when the resolved target is absent or is already selected', async () => {
  state.demoMode = false
  const message = { mailbox: 'Inbox', uid: 4 } as MailRow
  state.queryResults = [
    [{ path: 'Inbox', name: 'Inbox', delimiter: '/', specialUse: '\\Archive' }],
    []
  ]

  assert.equal(await moveMessage(message, 'archive'), null)
  assert.equal(await moveMessage(message, 'trash'), null)
  assert.deepEqual(state.moves, [])
})

test('replaces transformed OpenPGP content even when it was not decrypted', async () => {
  state.demoMode = false
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  const transformed = Buffer.from('Subject: Normalized\r\n\r\nTransformed body')
  state.openPgpResult = {
    signed: true,
    signatureStatus: 'valid',
    signer: null,
    fingerprint: null,
    encrypted: false,
    decrypted: false,
    error: null,
    rawMessage: transformed
  }
  state.insertReturningResults = [[]]
  state.queryResults = [
    [{ id: 42, messageId: '<transformed@example.test>', rawSource: source }],
    [],
    [{ id: 5 }]
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { textContent?: string } | undefined)?.textContent === 'Transformed body'
    )
  )
})

test('uses armored attached keys but excludes unrelated detached signatures', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <armored-key@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: multipart/mixed; boundary="pgp"',
      '',
      '--pgp',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1',
      '--pgp',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename="key.txt"',
      '',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      'test key',
      '-----END PGP PUBLIC KEY BLOCK-----',
      '--pgp',
      'Content-Type: application/pgp-signature',
      'Content-Disposition: attachment; filename="custom.asc"',
      '',
      'unrelated signature',
      '--pgp--'
    ].join('\r\n')
  )
  const key = { getFingerprint: () => 'attached-key' }
  state.readKey.mockResolvedValue(key)
  state.queryResults = [[{ id: 42, messageId: '<armored-key@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  const input = state.processInboundOpenPgp.mock.calls[0]?.[0] as {
    detachedSignatures: Buffer[]
    verificationKeys: unknown[]
  }
  assert.deepEqual(input.detachedSignatures, [])
  assert.deepEqual(input.verificationKeys, [key])
})

test('keeps unknown signatures unchanged when key discovery finds none and ignores unnamed signatures', async () => {
  state.demoMode = false
  state.parsedAddresses = [{ email: 'ada@example.test' }]
  const source = Buffer.from(
    [
      'Message-ID: <unknown-key@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: multipart/mixed; boundary="pgp"',
      '',
      '--pgp',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1',
      '--pgp',
      'Content-Type: application/pgp-signature',
      '',
      'unnamed signature',
      '--pgp--'
    ].join('\r\n')
  )
  state.queryResults = [[{ id: 42, messageId: '<unknown-key@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 1)
  assert.deepEqual(
    (state.processInboundOpenPgp.mock.calls[0]![0] as { detachedSignatures: Buffer[] })
      .detachedSignatures,
    []
  )
})

test('batches persisted read-state updates and durable jobs after five hundred copies', async () => {
  state.demoMode = false
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: index + 1,
    messageId: `<copy-${index + 1}@example.test>`,
    mailbox: 'Inbox',
    uid: index + 1,
    flags: '[]',
    threadKey: '<shared-thread@example.test>'
  }))
  state.queryResults = [
    rows.map(({ messageId }) => ({ messageId })),
    rows,
    [{ representativeMailboxEntryId: 501, latestUid: 501, latestReceivedAt: new Date() }],
    [{ value: 501 }]
  ]

  assert.equal(
    await markMessagesSeen(
      rows.map((row) => row.id),
      true
    ),
    501
  )

  const updates = state.calls.filter(
    (call) => call.operation === 'update' && (call.set as { flags?: string } | undefined)?.flags
  )
  const jobBatches = state.calls.filter(
    (call) =>
      call.operation === 'insert' &&
      Array.isArray(call.values) &&
      (call.values as Array<{ type?: string }>).every((job) => job.type === 'mark_read')
  )
  assert.equal(updates.length, 2)
  assert.deepEqual(
    jobBatches.map((call) => (call.values as unknown[]).length),
    [500, 1]
  )
  assert.deepEqual(state.dismissedNotifications, [rows.map((row) => row.id)])
})

test('shares an in-flight IMAP sync between concurrent callers', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  let releaseList: (() => void) | undefined
  const listed = new Promise<void>((resolve) => {
    releaseList = resolve
  })
  const listConnection = {
    list: vi.fn(async () => {
      await listed
      return []
    })
  }
  state.connections = [listConnection]

  const first = runMailboxSyncOnce()
  await Promise.resolve()
  const second = runMailboxSyncOnce()
  releaseList?.()

  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.equal(listConnection.list.mock.calls.length, 1)
})

test('ignores oversized attached PGP keys while processing the enclosing message', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <large-key@example.test>',
      'Content-Type: multipart/mixed; boundary="pgp"',
      '',
      '--pgp',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1',
      '--pgp',
      'Content-Type: application/pgp-keys',
      'Content-Disposition: attachment; filename="large.asc"',
      '',
      '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      'x'.repeat(2_000_001),
      '-----END PGP PUBLIC KEY BLOCK-----',
      '--pgp--'
    ].join('\r\n')
  )
  state.queryResults = [[{ id: 42, messageId: '<large-key@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.deepEqual(
    (state.processInboundOpenPgp.mock.calls[0]![0] as { verificationKeys: unknown[] })
      .verificationKeys,
    []
  )
  assert.equal(state.readKey.mock.calls.length, 0)
})

test('sorts persisted catalog mailboxes by standard role and uses fallback names', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      { path: 'Trash', configId: 'primary', remotePath: 'Trash', name: 'Trash', delimiter: '/' },
      { path: 'Junk', configId: 'primary', remotePath: 'Junk', name: 'Junk', delimiter: '/' },
      {
        path: 'All Mail',
        configId: 'primary',
        remotePath: 'All Mail',
        name: 'All Mail',
        delimiter: '/'
      },
      { path: 'Drafts', configId: 'primary', remotePath: 'Drafts', name: 'Drafts', delimiter: '/' },
      { path: 'Sent', configId: 'primary', remotePath: 'Sent', name: 'Sent', delimiter: '/' },
      { path: 'Inbox', configId: 'primary', remotePath: 'Inbox', name: 'Inbox', delimiter: '/' }
    ]
  ]

  assert.deepEqual(
    (await getImapMailboxes()).map((mailbox) => mailbox.path),
    ['Inbox', 'Sent', 'Drafts', 'All Mail', 'Junk', 'Trash']
  )
})

test('stores an IMAP message with a synthetic ID when its envelope omits Message-ID', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.insertReturningResults = [[{ id: 1 }]]
  const lock = { release: vi.fn() }
  const source = Buffer.from('From: Ada <ada@example.test>\r\n\r\nBody')
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 1, source }
        return
      }
      yield { uid: 1, envelope: {}, flags: new Set<string>(), internalDate: '2026-01-01T00:00:00Z' }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(lock.release.mock.calls.length, 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { messageId?: string } | undefined)?.messageId === 'synthetic:Inbox:1'
    )
  )
})

test('uses meaningful structured IMAP errors and safely terminates circular causes', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const error: Record<string, unknown> = {
    responseText: 'Mailbox access denied',
    response: 'alternate response',
    serverResponse: 'server response',
    stderr: 'stderr output',
    stdout: 'stdout output',
    command: 'LIST',
    code: 'NO'
  }
  error.cause = error
  const connection = {
    list: vi.fn(async () => {
      throw error
    })
  }
  state.connections = [connection]

  await assert.rejects(runMailboxSyncOnce(), (caught) => caught === error)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError === 'Mailbox access denied'
    )
  )
})

test('distinguishes missing raw sources and uses special-use mailboxes for spam moves', async () => {
  state.demoMode = false
  const message = { id: 7, mailbox: 'Inbox', uid: 4 } as MailRow
  state.queryResults = [
    [{ rawSource: null }],
    [
      {
        path: 'Provider Junk',
        configId: 'primary',
        remotePath: 'Junk',
        name: 'Provider Junk',
        delimiter: '/',
        specialUse: '\\Junk'
      }
    ]
  ]

  assert.equal(await getStoredRawMessageById(7), null)
  assert.equal(await moveMessage(message, 'spam'), 'Provider Junk')
  assert.deepEqual(state.moves, [{ uid: 4, mailbox: 'Inbox', targetMailbox: 'Provider Junk' }])
})

test('returns null for missing persisted details and malformed active placeholders', async () => {
  state.demoMode = false
  state.queryResults = [
    [],
    [
      {
        id: 13,
        payload: 'not json',
        status: 'pending',
        messageId: '<queued@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: true,
        deliveredAt: null,
        openedAt: null,
        createdAt: new Date()
      }
    ]
  ]

  assert.equal(await getStoredMessageById(7), null)
  assert.equal(await getStoredMessageById(-13), null)
})

test('uses numeric persisted raw IDs and falls back to a share message ID', async () => {
  state.demoMode = false
  const row = {
    id: 7,
    messageId: '<fallback@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'Fallback',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: null,
    threadId: '<thread@example.test>',
    textContent: 'Body',
    htmlContent: null,
    replyTo: null,
    inReplyTo: null,
    references: null
  } satisfies MailRow
  state.queryResults = [
    [{ rawSource: Buffer.from('raw numeric') }],
    [{ token: 'fallback-share', messageId: row.messageId, messageIds: null }],
    [row]
  ]

  assert.deepEqual(await getStoredRawMessageById(7), Buffer.from('raw numeric'))
  assert.deepEqual(await getSharedMessagesByShareToken('fallback-share'), [row])
})

test('returns zero for empty aggregate query results', async () => {
  state.demoMode = false
  state.queryResults = [[], [], [], [], [], [], [], [], [], [], [], [], [], []]

  assert.equal(await countStoredMessages('Inbox'), 0)
  assert.equal(await countMessagesBySender('Inbox', 'ada@example.test'), 0)
  assert.equal(await countStoredThreads('Inbox'), 0)
  assert.equal(await countStoredMessagesInMailboxes(['Inbox', 'Archive']), 0)
  assert.equal(await countStoredThreadsInMailboxes(['Inbox', 'Archive']), 0)
  assert.equal(await countSearchMessages('subject:Missing'), 0)
  assert.deepEqual(await getThreadMetadata('Inbox', '<missing@example.test>'), {
    starred: false,
    pinned: false
  })
})

test('syncs a targeted secondary account using its local mailbox path', async () => {
  state.demoMode = false
  const secondary = { ...imapConfig, id: 'secondary', name: 'Secondary' }
  state.configs = [secondary]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn()
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 7,
        uidValidity: 9,
        highestModseq: 12n,
        lastReconciledAt: new Date(),
        historyComplete: true,
        lastSyncedAt: null
      }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(syncConnection.status.mock.calls.length, 1)
})

test('counts unread persisted messages and retains thread counts absent from composed results', async () => {
  state.demoMode = false
  const thread = {
    id: 7,
    messageId: '<thread@example.test>',
    mailbox: 'Inbox',
    uid: 4,
    flags: '[]',
    subject: 'Thread',
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    cc: '',
    preview: 'Preview',
    receivedAt: new Date(),
    threadId: '<thread@example.test>',
    threadCount: 3,
    hasUnread: true,
    hasImportantUnread: false,
    hasThreadNote: false
  }
  state.queryResults = [[{ value: 2 }], [thread], [thread], []]

  assert.equal(await countStoredMessages('Inbox', true), 2)
  assert.equal(
    (await listStoredThreadsInMailboxes(['Inbox', 'Archive'], 100, 0, false, 'pinned'))[0]
      ?.threadCount,
    3
  )
})

test('omits PGP key and signature candidates when a hinted source has no parsed attachments', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <no-attachments@example.test>',
      'From: Ada <ada@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  state.simpleParserOverride = (parsed) => {
    const { attachments: _attachments, ...rest } = parsed
    return rest
  }
  state.queryResults = [[{ id: 42, messageId: '<no-attachments@example.test>', rawSource: source }]]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.equal(state.processInboundOpenPgp.mock.calls.length, 1)
  const call = state.processInboundOpenPgp.mock.calls[0]![0] as {
    detachedSignatures: Buffer[]
  }
  assert.deepEqual(call.detachedSignatures, [])
})

test('falls back to text, address, and reference defaults while skipping and defaulting new attachments', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.insertReturningResults = [[{ id: 1 }]]
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <field-defaults@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Field defaults',
      '',
      'Body text'
    ].join('\r\n')
  )
  state.simpleParserOverride = (parsed) => ({
    ...parsed,
    text: undefined,
    html: '<p>Hi</p>',
    references: ['<a@example.test>', '<b@example.test>'],
    to: { value: [{}], text: '' },
    cc: { value: undefined, text: 'CC Fallback' },
    attachments: [
      { contentDisposition: 'inline', content: Buffer.from('inline-img') },
      { contentDisposition: 'attachment', content: undefined },
      {
        contentDisposition: 'attachment',
        content: Buffer.from('attached body'),
        filename: undefined,
        contentType: undefined,
        size: undefined
      }
    ]
  })
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 1, source }
        return
      }
      yield {
        uid: 1,
        envelope: { messageId: '<field-defaults@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  const message = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { messageId?: string } | undefined)?.messageId ===
        '<field-defaults@example.test>'
  )
  assert.ok(message)
  const values = message!.values as {
    textContent?: string
    htmlContent?: string | null
    references?: string | null
    to?: string
    cc?: string
  }
  assert.equal(values.textContent, '')
  assert.equal(values.htmlContent, '<p>Hi</p>')
  assert.equal(values.references, '<a@example.test> <b@example.test>')
  assert.equal(values.to, '')
  assert.equal(values.cc, 'CC Fallback')

  const attachment = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { filename?: string } | undefined)?.filename === 'attachment'
  )
  assert.ok(attachment)
  const attachmentValues = attachment!.values as {
    contentType?: string
    size?: number
  }
  assert.equal(attachmentValues.contentType, 'application/octet-stream')
  assert.equal(attachmentValues.size, 'attached body'.length)
  assert.equal(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' && 'filename' in (call.values as Record<string, unknown>)
    ).length,
    1
  )
})

test('defaults missing OpenPGP signed, encrypted, and decrypted flags to false for new messages', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.insertReturningResults = [[{ id: 1 }]]
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <openpgp-flag-defaults@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: pgp- hint without explicit flags',
      '',
      'Body text'
    ].join('\r\n')
  )
  state.openPgpResult = {
    signed: undefined,
    signatureStatus: 'unknown',
    signer: null,
    fingerprint: null,
    encrypted: undefined,
    decrypted: undefined,
    error: null,
    rawMessage: source
  }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 1, source }
        return
      }
      yield {
        uid: 1,
        envelope: { messageId: '<openpgp-flag-defaults@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [],
    [],
    [],
    []
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  const mailboxEntry = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { messageId?: string } | undefined)?.messageId ===
        '<openpgp-flag-defaults@example.test>' &&
      'openPgpSigned' in (call.values as Record<string, unknown>)
  )
  assert.ok(mailboxEntry)
  const values = mailboxEntry!.values as {
    openPgpSigned?: boolean
    openPgpEncrypted?: boolean
    openPgpDecrypted?: boolean
  }
  assert.equal(values.openPgpSigned, false)
  assert.equal(values.openPgpEncrypted, false)
  assert.equal(values.openPgpDecrypted, false)
})

test('omits attachments entirely when replacing content for an existing message', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <replace-no-attachments@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const decryptedSource = Buffer.from(
    [
      'Message-ID: <replace-no-attachments@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Decrypted without attachments',
      '',
      'Plaintext body'
    ].join('\r\n')
  )
  state.simpleParserOverride = (parsed) => {
    const { attachments: _attachments, ...rest } = parsed
    return rest
  }
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.queryResults = [
    [{ id: 42, messageId: '<replace-no-attachments@example.test>', rawSource: source }],
    [],
    [],
    [{ id: 5 }],
    [],
    [],
    []
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.deepEqual(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' && 'filename' in (call.values as Record<string, unknown>)
    ),
    []
  )
})

test('skips inline and contentless attachments while defaulting fields when replacing content', async () => {
  state.demoMode = false
  const source = Buffer.from(
    [
      'Message-ID: <replace-attachments@example.test>',
      'Content-Type: application/pgp-encrypted',
      '',
      'Version: 1'
    ].join('\r\n')
  )
  const decryptedSource = Buffer.from(
    [
      'Message-ID: <replace-attachments@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Decrypted with attachments',
      '',
      'Plaintext body'
    ].join('\r\n')
  )
  state.simpleParserOverride = (parsed) => ({
    ...parsed,
    attachments: [
      { contentDisposition: 'inline', content: Buffer.from('inline-img') },
      {
        contentDisposition: 'attachment',
        content: Buffer.from('replaced body'),
        filename: undefined,
        contentType: undefined,
        size: undefined
      }
    ]
  })
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.queryResults = [
    [{ id: 42, messageId: '<replace-attachments@example.test>', rawSource: source }],
    [],
    [],
    [{ id: 5 }],
    [],
    [],
    []
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  const attachment = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { filename?: string } | undefined)?.filename === 'attachment'
  )
  assert.ok(attachment)
  const attachmentValues = attachment!.values as { contentType?: string; size?: number }
  assert.equal(attachmentValues.contentType, 'application/octet-stream')
  assert.equal(attachmentValues.size, 'replaced body'.length)
  assert.equal(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' && 'filename' in (call.values as Record<string, unknown>)
    ).length,
    1
  )
})

test('throws when a conflicting message insert cannot be resolved to an existing row', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const source = Buffer.from(
    [
      'Message-ID: <vanished@example.test>',
      'From: Ada <ada@example.test>',
      'To: Bob <bob@example.test>',
      'Subject: Vanished',
      '',
      'Body text'
    ].join('\r\n')
  )
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 2, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 2, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) {
        yield { uid: 1, source }
        return
      }
      yield {
        uid: 1,
        envelope: { messageId: '<vanished@example.test>' },
        flags: new Set<string>(),
        internalDate: new Date('2026-01-01T00:00:00Z')
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        highestModseq: 12n,
        historyComplete: true,
        lastReconciledAt: new Date(),
        lastSyncedAt: null
      }
    ],
    [], // insert onConflictDoNothing returning -> conflict, no row returned
    [] // fallback select for existing message -> also empty
  ]

  await assert.rejects(runMailboxSyncOnce(), /Unable to resolve stored message/)
})

test('uses an empty trusted authserv list when the environment variable is unset', async () => {
  state.demoMode = false
  state.trustedAuthservIds = undefined as unknown as string
  state.queryResults = [
    [
      {
        id: 9,
        messageId: '<untrusted-env@example.test>',
        mailbox: 'Inbox',
        uid: 1,
        flags: '[]',
        subject: 'Untrusted',
        from: 'Ada <ada@example.test>',
        to: 'Bob <bob@example.test>',
        cc: '',
        preview: 'Preview',
        receivedAt: null,
        threadId: '<thread@example.test>',
        textContent: 'Body',
        htmlContent: null,
        replyTo: null,
        inReplyTo: null,
        references: null,
        authservId: 'mx.example.test'
      }
    ]
  ]

  const rows = await listMessagesBySender('Inbox', 'ada@example.test')
  assert.equal(
    (rows[0] as MailRow & { authenticationTrusted?: boolean }).authenticationTrusted,
    false
  )
})

test('treats a blank thrown string as an unknown IMAP sync error', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const connection = {
    list: vi.fn(async () => {
      throw '   '
    })
  }
  state.connections = [connection]

  await assert.rejects(runMailboxSyncOnce(), (error) => error === '   ')
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { lastError?: string } | undefined)?.lastError === 'Unknown IMAP sync error'
    )
  )
})

test('sorts differently named mailboxes of the same special-use rank alphabetically', async () => {
  state.demoMode = false
  state.queryResults = [
    [
      {
        path: 'Zeta',
        configId: 'primary',
        remotePath: 'Zeta',
        name: 'Zeta',
        delimiter: '/',
        specialUse: null
      },
      {
        path: 'Alpha',
        configId: 'primary',
        remotePath: 'Alpha',
        name: 'Alpha',
        delimiter: '/',
        specialUse: null
      }
    ]
  ]

  const mailboxes = await getImapMailboxes()
  assert.deepEqual(
    mailboxes.map((mailbox) => mailbox.path),
    ['Alpha', 'Zeta']
  )
})

test('skips catalog inserts when a live listing returns no mailboxes but existing catalog rows exist', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => []) }
  state.connections = [listConnection]
  state.queryResults = [
    [],
    [],
    [
      {
        path: 'Inbox',
        configId: 'primary',
        remotePath: 'Inbox',
        name: 'Inbox',
        delimiter: '/',
        specialUse: null
      }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(
    state.calls.filter(
      (call) => call.operation === 'insert' && 'path' in (call.values as Record<string, unknown>)
    ),
    []
  )
})

test('summarizes sync without a runtime row or any recorded sync timestamp', async () => {
  state.demoMode = false
  state.config = imapConfig
  state.queryResults = [
    [],
    [{ mailbox: 'Inbox', lastSyncedAt: undefined, lastError: null }],
    [],
    [{ lastFetchedCount: 0, lastStoredCount: 0, lastSyncedAt: null, lastError: null }]
  ]

  assert.deepEqual(await getSyncSummary(), {
    syncing: false,
    configured: true,
    hasError: false,
    lastSyncedAt: null,
    errorMessage: null,
    progress: null
  })
  assert.deepEqual(await getMailboxSyncStatus('Inbox'), {
    mailbox: 'Inbox',
    configured: true,
    skipped: false,
    syncing: false,
    fetchedCount: 0,
    storedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    reason: undefined
  })
})

test('defaults omitted thread metadata flags in demo mode and to stored values otherwise', async () => {
  assert.deepEqual(await setThreadMetadata('Inbox', '<thread@example.test>', {}), {
    starred: false,
    pinned: false
  })

  state.demoMode = false
  state.queryResults = [[{ starred: false, pinned: true }], []]

  assert.deepEqual(await setThreadMetadata('Inbox', '<thread@example.test>', { starred: true }), {
    starred: true,
    pinned: true
  })
})

test('records a zero thread count when the summary count query returns no row', async () => {
  state.demoMode = false
  state.queryResults = [
    [{ representativeMailboxEntryId: 5, latestUid: 5, latestReceivedAt: null }],
    [],
    []
  ]

  await refreshThreadSummaries('Inbox', ['<thread@example.test>', ''])

  assert.equal(
    state.calls.filter(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { threadCount?: number } | undefined)?.threadCount === 0
    ).length,
    1
  )
})

test('filters stored messages and threads by the pinned thread metadata flag', async () => {
  state.demoMode = false
  state.queryResults = [[], [{ value: 0 }], [], [{ value: 0 }]]

  assert.deepEqual(await listStoredMessages('Inbox', 10, 0, false, 'pinned'), [])
  assert.equal(await countStoredMessages('Inbox', false, 'pinned'), 0)
  assert.deepEqual(await listStoredThreads('Inbox', 10, 0, false, 'pinned'), [])
  assert.equal(await countStoredThreads('Inbox', false, 'pinned'), 0)
})

test('drops queued sends whose job status has no send state', async () => {
  state.demoMode = false
  state.smtpConfigs = [{ id: 'smtp-1', from: 'Ada <ada@example.test>' }]
  state.queryResults = [
    [
      {
        id: 21,
        payload: JSON.stringify({ to: 'Bob <bob@example.test>', subject: 'Cancelled send' }),
        status: 'cancelled',
        messageId: '<cancelled@example.test>',
        sentMailbox: 'Sent',
        placeholderActive: true,
        deliveredAt: null,
        openedAt: null,
        createdAt: new Date('2026-02-01T12:00:00Z')
      }
    ],
    []
  ]

  assert.deepEqual(await listStoredMessages('Sent', 10), [])
})

test('orders merged Sent placeholders by pinned state, timestamp, then uid', async () => {
  state.demoMode = false
  state.smtpConfigs = []
  const sameTime = new Date('2026-02-01T12:00:00Z')
  const job = (id: number) => ({
    id,
    payload: JSON.stringify({ to: 'Bob <bob@example.test>', subject: `Queued ${id}` }),
    status: 'pending',
    messageId: `<queued-${id}@example.test>`,
    sentMailbox: 'Sent',
    placeholderActive: true,
    deliveredAt: null,
    openedAt: null,
    createdAt: sameTime
  })
  state.queryResults = [
    [job(1), job(2)],
    [
      {
        id: 31,
        messageId: '<pinned@example.test>',
        mailbox: 'Sent',
        uid: 3,
        flags: '[]',
        subject: 'Pinned',
        from: 'Ada <ada@example.test>',
        to: '',
        cc: '',
        preview: '',
        receivedAt: new Date('2026-02-02T12:00:00Z'),
        threadId: '<thread@example.test>',
        threadPinned: true
      },
      {
        id: 32,
        messageId: '<undated-a@example.test>',
        mailbox: 'Sent',
        uid: 4,
        flags: '[]',
        subject: 'Undated A',
        from: 'Ada <ada@example.test>',
        to: '',
        cc: '',
        preview: '',
        receivedAt: null,
        threadId: '<thread@example.test>',
        threadPinned: false
      },
      {
        id: 33,
        messageId: '<undated-b@example.test>',
        mailbox: 'Sent',
        uid: 5,
        flags: '[]',
        subject: 'Undated B',
        from: 'Ada <ada@example.test>',
        to: '',
        cc: '',
        preview: '',
        receivedAt: null,
        threadId: '<thread@example.test>',
        threadPinned: false
      }
    ]
  ]

  const messages = await listStoredMessages('Sent', 10)
  assert.deepEqual(messages[0]?.subject, 'Pinned')
  assert.deepEqual(
    messages
      .slice(1)
      .map(({ subject }) => subject)
      .sort(),
    ['Queued 1', 'Queued 2', 'Undated A', 'Undated B']
  )
})

test('stores null catalog identifiers when a listing and its account omit them', async () => {
  state.demoMode = false
  state.configs = [{ ...imapConfig, id: undefined }]
  const listConnection = {
    list: vi.fn(async () => [{ name: 'Weird', flags: new Set(['\\Noselect']) }])
  }
  state.connections = [listConnection]
  state.queryResults = [[], [], [], [], [], [], [], []]

  assert.equal(await runMailboxSyncOnce(), true)
  const catalogInsert = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { name?: string } | undefined)?.name === 'Weird'
  )
  assert.deepEqual(
    (catalogInsert!.values as { configId: string | null; remotePath: string | null }).configId,
    null
  )
  assert.deepEqual(
    (catalogInsert!.values as { configId: string | null; remotePath: string | null }).remotePath,
    null
  )
})

test('logs a slow thread key resolution that stays on the message itself', async () => {
  state.demoMode = false
  let time = 0
  const now = vi.spyOn(Date, 'now').mockImplementation(() => (time += 30_000))
  const source = Buffer.from('Content-Type: application/pgp-encrypted\r\n\r\nVersion: 1')
  const decryptedSource = Buffer.from(
    'Message-ID: <self@example.test>\r\nIn-Reply-To: <root@example.test>\r\n\r\nPlaintext body'
  )
  state.openPgpResult = {
    signed: false,
    signatureStatus: null,
    signer: null,
    fingerprint: null,
    encrypted: true,
    decrypted: true,
    error: null,
    rawMessage: decryptedSource
  }
  state.insertReturningResults = [[{ id: 5 }]]
  state.queryResults = [
    [{ id: 42, messageId: '<self@example.test>', rawSource: source }],
    [{ rawSource: source }],
    [{ messageId: '<root@example.test>', threadKey: '<self@example.test>' }]
  ]

  assert.equal(await backfillOpenPgpFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { threadKey?: string } | undefined)?.threadKey === '<self@example.test>'
    )
  )
  now.mockRestore()
})

test('lists unread persisted messages and starred threads through their own filters', async () => {
  state.demoMode = false
  state.queryResults = [[], [], [{ value: 0 }]]

  assert.deepEqual(await listStoredMessages('Inbox', 10, 0, true), [])
  assert.deepEqual(await listStoredThreads('Inbox', 10, 0, false, 'starred'), [])
  assert.equal(await countStoredThreads('Inbox', false, 'starred'), 0)
})

test('renders a demo raw message without a received date', async () => {
  state.demoStoredMessageOverride = {
    id: 1,
    messageId: '<undated@example.test>',
    receivedAt: null,
    from: 'Ada <ada@example.test>',
    to: 'Bob <bob@example.test>',
    subject: 'Undated',
    textContent: 'Body'
  }

  const raw = await getStoredRawMessageById(1)
  assert.match(raw!.toString('utf8'), /^Date: $/m)
})

test('parses raw backfill sources that expose no header lines', async () => {
  state.demoMode = false
  state.simpleParserOverride = (parsed) => ({ ...parsed, headerLines: undefined })
  const source = Buffer.from(
    ['Message-ID: <headerless@example.test>', 'Subject: Headerless', '', 'Body'].join('\r\n')
  )
  const connection = {
    mailboxOpen: vi.fn(async () => undefined),
    mailbox: { uidValidity: 9n },
    fetch: vi.fn(async function* () {
      yield { uid: 4, source }
    })
  }
  state.configs = [imapConfig]
  state.connections = [connection]
  state.queryResults = [
    [
      {
        id: 12,
        messageId: '<headerless@example.test>',
        mailbox: 'Inbox',
        uid: 4,
        uidValidity: 9,
        attempts: 0,
        configId: 'primary',
        remoteMailbox: 'Inbox'
      }
    ],
    [],
    []
  ]

  assert.equal(await backfillMailAuthenticationFromWorker(), 1)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' &&
        (call.set as { spfStatus?: string | null } | undefined)?.spfStatus === null
    )
  )
})

const reconcileScope = { mailboxes: new Map([['primary', new Set(['Inbox'])]]) }

const reconcileSyncConnections = (reconcileConnection: Record<string, unknown>) => {
  const syncLock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 1, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => syncLock),
    mailbox: { uidValidity: 9n, uidNext: 1, highestModseq: 12n, usable: true },
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection, reconcileConnection]
  return { syncLock }
}

const reconcileState = [
  [],
  [],
  [],
  [],
  [],
  [],
  [
    {
      lastUid: 0,
      uidValidity: 9,
      highestModseq: 12n,
      historyComplete: true,
      lastReconciledAt: new Date(),
      lastSyncedAt: null
    }
  ],
  [],
  []
] as unknown[]

test('fails a reconciliation when the remote UID SEARCH is rejected', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const reconcileLock = { release: vi.fn() }
  reconcileSyncConnections({
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set<string>(),
    search: vi.fn(async () => false)
  })
  state.queryResults = [...reconcileState]

  await assert.rejects(runMailboxSyncOnce(reconcileScope), /UID SEARCH failed for Inbox/)
  assert.equal(reconcileLock.release.mock.calls.length, 1)
})

test('reconciles an empty remote mailbox without fetching flags or dismissing reads', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const reconcileLock = { release: vi.fn() }
  const fetch = vi.fn()
  reconcileSyncConnections({
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set<string>(),
    search: vi.fn(async () => []),
    fetch
  })
  state.queryResults = [...reconcileState]

  assert.equal(await runMailboxSyncOnce(reconcileScope), true)
  assert.equal(fetch.mock.calls.length, 0)
  assert.deepEqual(state.dismissedNotifications, [])
})

test('reconciles flagless fetch responses and read jobs that stay unconfirmed', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const reconcileLock = { release: vi.fn() }
  reconcileSyncConnections({
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set<string>(),
    search: vi.fn(async () => [1, 2, 3]),
    fetch: vi.fn(async function* (range: string) {
      yield {}
      if (range === '1:3') yield { uid: 1 }
      if (range === '2:3') yield { uid: 2 }
    })
  })
  state.queryResults = [
    ...reconcileState,
    [{ id: 10, uid: 1, flags: '["\\\\Seen"]', threadKey: '<thread@example.test>' }],
    [
      { id: 1, uid: null, type: 'mark_read', status: 'done' },
      { id: 2, uid: 2, type: 'mark_read', status: 'done' },
      { id: 3, uid: 3, type: 'mark_read', status: 'done' }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(reconcileScope), true)
  assert.deepEqual(state.dismissedNotifications, [])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'update' && (call.set as { flags?: string } | undefined)?.flags === '[]'
    )
  )
})

test('rethrows reconciliation failures that are not CONDSTORE rejections', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const reconcileLock = { release: vi.fn() }
  reconcileSyncConnections({
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n, highestModseq: 13n },
    capabilities: new Set(['CONDSTORE']),
    search: vi.fn(async () => {
      throw new Error('reconcile exploded')
    })
  })
  state.queryResults = [...reconcileState]

  await assert.rejects(runMailboxSyncOnce(reconcileScope), /reconcile exploded/)
  assert.equal(reconcileLock.release.mock.calls.length, 1)
})

test('reconciles a remote mailbox that reports no highest modseq', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const reconcileLock = { release: vi.fn() }
  reconcileSyncConnections({
    getMailboxLock: vi.fn(async () => reconcileLock),
    mailbox: { uidValidity: 9n },
    capabilities: new Set<string>(),
    search: vi.fn(async () => []),
    fetch: vi.fn()
  })
  state.queryResults = [...reconcileState]

  assert.equal(await runMailboxSyncOnce(reconcileScope), true)
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { highestModseq?: bigint | null } | undefined)?.highestModseq === null
    )
  )
})

test('backs off a mailbox whose initial sync recently failed', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  state.connections = [listConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [
      {
        lastUid: 0,
        uidValidity: 9,
        historyComplete: false,
        lastError: 'initial backfill failed',
        lastSyncedAt: new Date()
      }
    ]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(state.connections.length, 0)
})

test('fails a sync when the locked IMAP mailbox is not selected', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = []

  await assert.rejects(runMailboxSyncOnce(), /Mailbox Inbox was not selected/)
  assert.equal(lock.release.mock.calls.length, 1)
})

test('rethrows IMAP listing failures raised before a connection is established', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.connections = [new Error('authentication failed')]
  state.queryResults = []

  await assert.rejects(runMailboxSyncOnce(), /authentication failed/)
  assert.deepEqual(state.invalidated, [])
})

test('rethrows mailbox sync failures raised before a connection is established', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  state.connections = [listConnection, new Error('authentication failed')]
  state.queryResults = []

  await assert.rejects(runMailboxSyncOnce(), /authentication failed/)
  assert.deepEqual(state.invalidated, [])
})

test('skips unusable IMAP fetch responses while ingesting an existing message', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.simpleParserOverride = (parsed) => ({ ...parsed, headerLines: undefined })
  const source = Buffer.from(
    ['Message-ID: <existing@example.test>', 'Subject: Existing', '', 'Body'].join('\r\n')
  )
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      yield {}
      if (query.source) {
        yield { uid: 7 }
        yield { uid: 99, source }
        yield { uid: 7, source }
      } else {
        yield { uid: 7 }
      }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ id: 1 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(lock.release.mock.calls.length, 1)
  assert.deepEqual(state.filteredMessageIds, [])
  assert.ok(
    state.calls.some(
      (call) =>
        call.operation === 'insert' &&
        (call.values as { messageId?: string } | undefined)?.messageId === 'synthetic:Inbox:7'
    )
  )
})

test('stores an oversized IMAP source without persisting its raw bytes', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const source = Buffer.alloc(25 * 1024 * 1024 + 1, ' ')
  source.write('Message-ID: <huge@example.test>\r\nSubject: Huge\r\n\r\n')
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) yield { uid: 7, source }
      else
        yield { uid: 7, envelope: { messageId: '<huge@example.test>' }, flags: new Set<string>() }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ id: 1 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  const entry = state.calls.find(
    (call) =>
      call.operation === 'insert' &&
      (call.values as { messageId?: string; uid?: number } | undefined)?.messageId ===
        '<huge@example.test>' &&
      (call.values as { uid?: number } | undefined)?.uid === 7
  )
  assert.equal((entry!.values as { rawSource: Buffer | null }).rawSource, null)
})

test('stores new messages without pushing when a mailbox opts out of notifications', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  state.shouldNotifyMailbox = false
  const source = Buffer.from(
    ['Message-ID: <quiet@example.test>', 'Subject: Quiet', '', 'Body'].join('\r\n')
  )
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) yield { uid: 7, source }
      else
        yield { uid: 7, envelope: { messageId: '<quiet@example.test>' }, flags: new Set<string>() }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ id: 1 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(state.filteredMessageIds, [['<quiet@example.test>']])
  assert.deepEqual(state.sentPushes, [])
})

test('names the push sender from a display name when one is present', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const source = Buffer.from(
    ['Message-ID: <loud@example.test>', 'Subject: Loud', '', 'Body'].join('\r\n')
  )
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n, usable: true },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) yield { uid: 7, source }
      else
        yield { uid: 7, envelope: { messageId: '<loud@example.test>' }, flags: new Set<string>() }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ id: 1 }],
    [],
    [],
    [],
    [],
    [{ id: 5, subject: 'Loud', from: 'Ada Lovelace <ada@example.test>' }],
    [{ count: 3 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.deepEqual(
    state.sentPushes.map(({ title, body, unreadCount }) => ({ title, body, unreadCount })),
    [{ title: 'Loud', body: 'From: Ada Lovelace', unreadCount: 3 }]
  )
})

test('skips the sync keep-alive ping while the IMAP session is unusable', async () => {
  state.demoMode = false
  state.configs = [imapConfig]
  const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
    ;(callback as () => void)()
    return 1 as unknown as NodeJS.Timeout
  })
  const source = Buffer.from(
    ['Message-ID: <stale@example.test>', 'Subject: Stale', '', 'Body'].join('\r\n')
  )
  const lock = { release: vi.fn() }
  const listConnection = { list: vi.fn(async () => [{ path: 'Inbox', name: 'Inbox' }]) }
  const syncConnection = {
    usable: false,
    status: vi.fn(async () => ({ uidNext: 8, uidValidity: 9n, highestModseq: 12n })),
    getMailboxLock: vi.fn(async () => lock),
    mailbox: { uidValidity: 9n, uidNext: 8, highestModseq: 12n },
    fetch: vi.fn(async function* (_range: string, query: { source?: boolean }) {
      if (query.source) yield { uid: 7, source }
      else
        yield { uid: 7, envelope: { messageId: '<stale@example.test>' }, flags: new Set<string>() }
    }),
    noop: vi.fn(async () => undefined)
  }
  state.connections = [listConnection, syncConnection]
  state.queryResults = [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ lastUid: 6, uidValidity: 9, historyComplete: true, lastReconciledAt: new Date() }],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ id: 1 }]
  ]

  assert.equal(await runMailboxSyncOnce(), true)
  assert.equal(syncConnection.noop.mock.calls.length, 0)
  setIntervalSpy.mockRestore()
})
