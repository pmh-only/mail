import { randomUUID } from 'node:crypto'
import { env } from '$env/dynamic/private'
import { contactDisplay, normalizeEmail, parseAddressFields, type ContactInput } from './contacts'

type DemoUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
}

type DemoSession = {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export function isDemoModeEnabled() {
  const value = env.DEMO_MODE?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export type DemoConfigSection = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  source: string
}

type DemoDisplayConfig = {
  signature: string
  imap: DemoConfigSection & { mailbox: string; pollSeconds: number }
  smtp: DemoConfigSection & { from: string }
  oidc: {
    discoveryUrl: string
    clientId: string
    clientSecret: string
    source: string
  }
}

export type DemoMailRow = {
  id: number
  messageId: string
  mailbox: string
  uid: number
  flags: string
  subject: string
  from: string
  to: string
  cc: string
  preview: string
  receivedAt: Date | null
  threadId: string | null
  textContent: string
  htmlContent: string | null
  replyTo: string | null
  inReplyTo: string | null
  references: string | null
}

type DemoAttachment = {
  id: number
  messageId: string
  filename: string
  contentType: string
  size: number
  content: Buffer
}

type DemoContact = {
  id: number
  name: string
  email: string
  source: 'auto' | 'manual'
  useCount: number
  lastUsedAt: Date | null
  updatedAt: Date
}

type DemoDraft = {
  id: number
  toAddr: string
  cc: string
  bcc: string
  subject: string
  html: string
  attachments: string
  inReplyTo: string | null
  createdAt: Date
  updatedAt: Date
}

type DemoFilter = {
  id: number
  field: string
  operator: string
  value: string
  action: string
  target: string | null
  enabled: boolean
  sortOrder: number
}

type DemoMailbox = {
  path: string
  name: string
  delimiter: string
}

const now = Date.now()
const DEMO_RESET_MS = 10 * 60 * 1000

const demoConfig: DemoDisplayConfig = {
  signature: '<p>Best,<br />Demo User</p>',
  imap: {
    host: 'demo-imap.local',
    port: 993,
    secure: true,
    user: 'demo@example.com',
    password: 'demo-password',
    mailbox: 'Inbox',
    pollSeconds: 15,
    source: 'demo'
  },
  smtp: {
    host: 'demo-smtp.local',
    port: 587,
    secure: false,
    user: 'demo@example.com',
    password: 'demo-password',
    from: 'Demo User <demo@example.com>',
    source: 'demo'
  },
  oidc: {
    discoveryUrl: 'https://demo-identity.local/.well-known/openid-configuration',
    clientId: 'demo-client',
    clientSecret: 'demo-secret',
    source: 'demo'
  }
}

const demoMailboxes: DemoMailbox[] = [
  { path: 'Inbox', name: 'Inbox', delimiter: '/' },
  { path: 'Sent', name: 'Sent', delimiter: '/' },
  { path: 'Archive', name: 'Archive', delimiter: '/' },
  { path: 'Trash', name: 'Trash', delimiter: '/' },
  { path: 'Spam', name: 'Spam', delimiter: '/' }
]

let demoMessages: DemoMailRow[] = [
  {
    id: 101,
    messageId: '<demo-1@mail.local>',
    mailbox: 'Inbox',
    uid: 101,
    flags: '[]',
    subject: 'Welcome to demo mode',
    from: 'Product Team <team@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'This inbox runs entirely in memory so you can explore compose, drafts, contacts, filters, threads, sharing, and attachments safely.',
    receivedAt: new Date(now - 45 * 60 * 1000),
    threadId: 'thread-demo-welcome',
    textContent:
      'Welcome to demo mode. This inbox runs entirely in memory so you can explore compose, drafts, contacts, filters, threads, sharing, and attachments safely.',
    htmlContent:
      '<p>Welcome to <strong>demo mode</strong>.</p><p>This inbox runs entirely in memory so you can explore compose, drafts, contacts, filters, threads, sharing, and attachments safely.</p>',
    replyTo: 'team@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 102,
    messageId: '<demo-2@mail.local>',
    mailbox: 'Inbox',
    uid: 102,
    flags: '["\\\\Seen"]',
    subject: 'Launch checklist thread',
    from: 'Alex Founder <alex@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: 'Nina Ops <nina@example.com>',
    preview: 'Can you review the launch checklist before the customer walkthrough this afternoon?',
    receivedAt: new Date(now - 3 * 60 * 60 * 1000),
    threadId: 'thread-demo-launch',
    textContent:
      'Can you review the launch checklist before the customer walkthrough this afternoon?',
    htmlContent:
      '<p>Can you review the <strong>launch checklist</strong> before the customer walkthrough this afternoon?</p>',
    replyTo: 'alex@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 103,
    messageId: '<demo-3@mail.local>',
    mailbox: 'Inbox',
    uid: 103,
    flags: '[]',
    subject: 'Re: Launch checklist thread',
    from: 'Nina Ops <nina@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: 'Alex Founder <alex@example.com>',
    preview: 'Added the final screenshots and attached the rollout brief for the demo meeting.',
    receivedAt: new Date(now - 2 * 60 * 60 * 1000),
    threadId: 'thread-demo-launch',
    textContent:
      'Added the final screenshots and attached the rollout brief for the demo meeting.',
    htmlContent:
      '<p>Added the final screenshots and attached the rollout brief for the demo meeting.</p>',
    replyTo: 'nina@example.com',
    inReplyTo: '<demo-2@mail.local>',
    references: '<demo-2@mail.local>'
  },
  {
    id: 104,
    messageId: '<demo-4@mail.local>',
    mailbox: 'Archive',
    uid: 104,
    flags: '["\\\\Seen"]',
    subject: 'Quarterly numbers attached',
    from: 'Finance <finance@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'Archive sample with an attachment for preview and download.',
    receivedAt: new Date(now - 26 * 60 * 60 * 1000),
    threadId: 'thread-demo-finance',
    textContent: 'Archive sample with an attachment for preview and download.',
    htmlContent: '<p>Archive sample with an attachment for preview and download.</p>',
    replyTo: 'finance@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 105,
    messageId: '<demo-5@mail.local>',
    mailbox: 'Spam',
    uid: 105,
    flags: '[]',
    subject: 'You won a suspicious prize',
    from: 'Totally Legit <spam@example.net>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'Spam mailbox sample so move and recovery actions have somewhere to go.',
    receivedAt: new Date(now - 9 * 60 * 60 * 1000),
    threadId: 'thread-demo-spam',
    textContent: 'Spam mailbox sample so move and recovery actions have somewhere to go.',
    htmlContent: '<p>Spam mailbox sample so move and recovery actions have somewhere to go.</p>',
    replyTo: null,
    inReplyTo: null,
    references: null
  },
  {
    id: 106,
    messageId: '<demo-6@mail.local>',
    mailbox: 'Inbox',
    uid: 106,
    flags: '[]',
    subject: 'Customer feedback from pilot group',
    from: 'Maya Customer Success <maya@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: 'Alex Founder <alex@example.com>',
    preview: 'Three pilot users asked for faster search, clearer attachment previews, and keyboard shortcut hints.',
    receivedAt: new Date(now - 70 * 60 * 1000),
    threadId: 'thread-demo-pilot',
    textContent:
      'Three pilot users asked for faster search, clearer attachment previews, and keyboard shortcut hints. We should highlight those in the walkthrough.',
    htmlContent:
      '<p>Three pilot users asked for faster search, clearer attachment previews, and keyboard shortcut hints.</p><p>We should highlight those in the walkthrough.</p>',
    replyTo: 'maya@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 107,
    messageId: '<demo-7@mail.local>',
    mailbox: 'Inbox',
    uid: 107,
    flags: '["\\\\Seen"]',
    subject: 'Design review notes',
    from: 'Iris Design <iris@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'Spacing in the message pane looks good, but the empty states need stronger copy and a clearer next step.',
    receivedAt: new Date(now - 5 * 60 * 60 * 1000),
    threadId: 'thread-demo-design',
    textContent:
      'Spacing in the message pane looks good, but the empty states need stronger copy and a clearer next step.',
    htmlContent:
      '<p>Spacing in the message pane looks good, but the empty states need stronger copy and a clearer next step.</p>',
    replyTo: 'iris@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 108,
    messageId: '<demo-8@mail.local>',
    mailbox: 'Inbox',
    uid: 108,
    flags: '[]',
    subject: 'Re: Design review notes',
    from: 'Demo User <demo@example.com>',
    to: 'Iris Design <iris@example.com>',
    cc: '',
    preview: 'Agreed. I will tighten the empty state copy and keep the current layout density for the demo build.',
    receivedAt: new Date(now - 4 * 60 * 60 * 1000),
    threadId: 'thread-demo-design',
    textContent:
      'Agreed. I will tighten the empty state copy and keep the current layout density for the demo build.',
    htmlContent:
      '<p>Agreed. I will tighten the empty state copy and keep the current layout density for the demo build.</p>',
    replyTo: 'demo@example.com',
    inReplyTo: '<demo-7@mail.local>',
    references: '<demo-7@mail.local>'
  },
  {
    id: 109,
    messageId: '<demo-9@mail.local>',
    mailbox: 'Inbox',
    uid: 109,
    flags: '[]',
    subject: 'Weekly metrics snapshot',
    from: 'Metrics Bot <metrics@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'Inbox zero rate is up 12 percent, average response time is down 18 percent, and mobile usage continues to climb.',
    receivedAt: new Date(now - 8 * 60 * 60 * 1000),
    threadId: 'thread-demo-metrics',
    textContent:
      'Inbox zero rate is up 12 percent, average response time is down 18 percent, and mobile usage continues to climb.',
    htmlContent:
      '<p>Inbox zero rate is up 12 percent, average response time is down 18 percent, and mobile usage continues to climb.</p>',
    replyTo: 'metrics@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 110,
    messageId: '<demo-10@mail.local>',
    mailbox: 'Sent',
    uid: 110,
    flags: '["\\\\Seen"]',
    subject: 'Recap for investor sync',
    from: 'Demo User <demo@example.com>',
    to: 'Board <board@example.com>',
    cc: '',
    preview: 'Sharing the short product recap ahead of tomorrow morning so everyone can review the inbox demo flow.',
    receivedAt: new Date(now - 13 * 60 * 60 * 1000),
    threadId: 'thread-demo-investor',
    textContent:
      'Sharing the short product recap ahead of tomorrow morning so everyone can review the inbox demo flow.',
    htmlContent:
      '<p>Sharing the short product recap ahead of tomorrow morning so everyone can review the inbox demo flow.</p>',
    replyTo: 'demo@example.com',
    inReplyTo: null,
    references: null
  },
  {
    id: 111,
    messageId: '<demo-11@mail.local>',
    mailbox: 'Trash',
    uid: 111,
    flags: '["\\\\Seen"]',
    subject: 'Obsolete staging alert',
    from: 'Infra Alerts <infra@example.com>',
    to: 'Demo User <demo@example.com>',
    cc: '',
    preview: 'Old alert retained in Trash so delete and restore related UI states have realistic content.',
    receivedAt: new Date(now - 30 * 60 * 60 * 1000),
    threadId: 'thread-demo-alerts',
    textContent:
      'Old alert retained in Trash so delete and restore related UI states have realistic content.',
    htmlContent:
      '<p>Old alert retained in Trash so delete and restore related UI states have realistic content.</p>',
    replyTo: 'infra@example.com',
    inReplyTo: null,
    references: null
    }
]

const demoAttachments: DemoAttachment[] = [
  {
    id: 201,
    messageId: '<demo-3@mail.local>',
    filename: 'rollout-brief.txt',
    contentType: 'text/plain; charset=utf-8',
    content: Buffer.from('Demo rollout brief\n\n- Inbox\n- Threads\n- Contacts\n- Drafts\n'),
    size: Buffer.byteLength('Demo rollout brief\n\n- Inbox\n- Threads\n- Contacts\n- Drafts\n')
  },
  {
    id: 202,
    messageId: '<demo-4@mail.local>',
    filename: 'numbers.csv',
    contentType: 'text/csv; charset=utf-8',
    content: Buffer.from('month,revenue\nJan,12000\nFeb,16800\nMar,17450\n'),
    size: Buffer.byteLength('month,revenue\nJan,12000\nFeb,16800\nMar,17450\n')
  }
]

let demoContacts: DemoContact[] = [
  {
    id: 301,
    name: 'Alex Founder',
    email: 'alex@example.com',
    source: 'manual',
    useCount: 7,
    lastUsedAt: new Date(now - 2 * 60 * 60 * 1000),
    updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000)
  },
  {
    id: 302,
    name: 'Nina Ops',
    email: 'nina@example.com',
    source: 'auto',
    useCount: 4,
    lastUsedAt: new Date(now - 2 * 60 * 60 * 1000),
    updatedAt: new Date(now - 24 * 60 * 60 * 1000)
  }
]

let demoDrafts: DemoDraft[] = [
  {
    id: 401,
    toAddr: 'alex@example.com',
    cc: '',
    bcc: '',
    subject: 'Draft: follow-up notes',
    html: '<p>Here are the follow-up notes from the demo.</p>',
    attachments: '[]',
    inReplyTo: null,
    createdAt: new Date(now - 4 * 60 * 60 * 1000),
    updatedAt: new Date(now - 10 * 60 * 1000)
  }
]

let demoFilters: DemoFilter[] = [
  {
    id: 501,
    field: 'from',
    operator: 'contains',
    value: 'finance@example.com',
    action: 'move',
    target: 'Archive',
    enabled: true,
    sortOrder: 0
  },
  {
    id: 502,
    field: 'subject',
    operator: 'contains',
    value: 'prize',
    action: 'spam',
    target: null,
    enabled: true,
    sortOrder: 1
  }
]

const demoShares = new Map<string, string>()
let nextMessageId = 112
let nextAttachmentId = 203
let nextContactId = 303
let nextDraftId = 402
let nextFilterId = 503

const initialDemoConfig = {
  signature: demoConfig.signature,
  imap: { ...demoConfig.imap },
  smtp: { ...demoConfig.smtp },
  oidc: { ...demoConfig.oidc }
}
const initialDemoMessages = demoMessages.map((message) => ({
  ...message,
  receivedAt: message.receivedAt ? new Date(message.receivedAt) : null
}))
const initialDemoAttachments = demoAttachments.map((attachment) => ({
  ...attachment,
  content: Buffer.from(attachment.content)
}))
const initialDemoContacts = demoContacts.map((contact) => ({
  ...contact,
  lastUsedAt: contact.lastUsedAt ? new Date(contact.lastUsedAt) : null,
  updatedAt: new Date(contact.updatedAt)
}))
const initialDemoDrafts = demoDrafts.map((draft) => ({
  ...draft,
  createdAt: new Date(draft.createdAt),
  updatedAt: new Date(draft.updatedAt)
}))
const initialDemoFilters = demoFilters.map((filter) => ({ ...filter }))
const initialNextMessageId = nextMessageId
const initialNextAttachmentId = nextAttachmentId
const initialNextContactId = nextContactId
const initialNextDraftId = nextDraftId
const initialNextFilterId = nextFilterId

function resetDemoState() {
  demoConfig.signature = initialDemoConfig.signature
  Object.assign(demoConfig.imap, initialDemoConfig.imap)
  Object.assign(demoConfig.smtp, initialDemoConfig.smtp)
  Object.assign(demoConfig.oidc, initialDemoConfig.oidc)

  demoMessages = initialDemoMessages.map((message) => ({
    ...message,
    receivedAt: message.receivedAt ? new Date(message.receivedAt) : null
  }))
  demoAttachments.length = 0
  demoAttachments.push(
    ...initialDemoAttachments.map((attachment) => ({
      ...attachment,
      content: Buffer.from(attachment.content)
    }))
  )
  demoContacts = initialDemoContacts.map((contact) => ({
    ...contact,
    lastUsedAt: contact.lastUsedAt ? new Date(contact.lastUsedAt) : null,
    updatedAt: new Date(contact.updatedAt)
  }))
  demoDrafts = initialDemoDrafts.map((draft) => ({
    ...draft,
    createdAt: new Date(draft.createdAt),
    updatedAt: new Date(draft.updatedAt)
  }))
  demoFilters = initialDemoFilters.map((filter) => ({ ...filter }))
  demoShares.clear()

  nextMessageId = initialNextMessageId
  nextAttachmentId = initialNextAttachmentId
  nextContactId = initialNextContactId
  nextDraftId = initialNextDraftId
  nextFilterId = initialNextFilterId
}

if (isDemoModeEnabled()) {
  const timer = setInterval(resetDemoState, DEMO_RESET_MS)
  timer.unref?.()
}

const demoUser: DemoUser = {
  id: 'demo-user',
  name: 'Demo User',
  email: 'demo@example.com',
  emailVerified: true,
  createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now)
}

const demoSession: DemoSession = {
  id: 'demo-session',
  userId: demoUser.id,
  token: 'demo-session-token',
  expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000),
  createdAt: new Date(now - 24 * 60 * 60 * 1000),
  updatedAt: new Date(now)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function looksKorean(value: string) {
  return /korean|ko\b|한국|한글/i.test(value)
}

function textPreview(value: string, fallback: string) {
  const normalized = stripHtml(value)
  return normalized || fallback
}

function sortedMessages(rows: DemoMailRow[]) {
  return [...rows].sort((left, right) => {
    const leftTime = left.receivedAt?.getTime() ?? 0
    const rightTime = right.receivedAt?.getTime() ?? 0
    if (rightTime !== leftTime) return rightTime - leftTime
    return right.uid - left.uid
  })
}

function serializeContactRow(contact: DemoContact) {
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

export function getDemoAuthSession() {
  return { user: demoUser, session: demoSession }
}

export function getDemoDisplayConfig() {
  return {
    signature: demoConfig.signature,
    imap: { ...demoConfig.imap, password: '••••••••' },
    smtp: { ...demoConfig.smtp, password: '••••••••' },
    oidc: { ...demoConfig.oidc, clientSecret: '••••••••' }
  }
}

export function getDemoImapConfig() {
  return { ...demoConfig.imap }
}

export function getDemoSmtpConfig() {
  return { ...demoConfig.smtp }
}

export function getDemoOidcConfig() {
  return { ...demoConfig.oidc }
}

export function saveDemoSettings(body: Record<string, unknown>) {
  if (typeof body.signature === 'string') demoConfig.signature = body.signature
  if (body.imap && typeof body.imap === 'object') {
    const imap = body.imap as Record<string, unknown>
    if (typeof imap.host === 'string') demoConfig.imap.host = imap.host.trim() || demoConfig.imap.host
    if (typeof imap.port === 'number' && imap.port > 0) demoConfig.imap.port = imap.port
    if (typeof imap.secure === 'boolean') demoConfig.imap.secure = imap.secure
    if (typeof imap.user === 'string') demoConfig.imap.user = imap.user.trim() || demoConfig.imap.user
    if (typeof imap.password === 'string' && imap.password.trim() && imap.password !== '••••••••') {
      demoConfig.imap.password = imap.password
    }
    if (typeof imap.mailbox === 'string') demoConfig.imap.mailbox = imap.mailbox.trim() || demoConfig.imap.mailbox
    if (typeof imap.pollSeconds === 'number' && imap.pollSeconds > 0) {
      demoConfig.imap.pollSeconds = imap.pollSeconds
    }
  }

  if (body.smtp && typeof body.smtp === 'object') {
    const smtp = body.smtp as Record<string, unknown>
    if (typeof smtp.host === 'string') demoConfig.smtp.host = smtp.host.trim() || demoConfig.smtp.host
    if (typeof smtp.port === 'number' && smtp.port > 0) demoConfig.smtp.port = smtp.port
    if (typeof smtp.secure === 'boolean') demoConfig.smtp.secure = smtp.secure
    if (typeof smtp.user === 'string') demoConfig.smtp.user = smtp.user.trim() || demoConfig.smtp.user
    if (typeof smtp.password === 'string' && smtp.password.trim() && smtp.password !== '••••••••') {
      demoConfig.smtp.password = smtp.password
    }
    if (typeof smtp.from === 'string') demoConfig.smtp.from = smtp.from.trim() || demoConfig.smtp.from
  }

  if (body.oidc && typeof body.oidc === 'object') {
    const oidc = body.oidc as Record<string, unknown>
    if (typeof oidc.discoveryUrl === 'string') {
      demoConfig.oidc.discoveryUrl = oidc.discoveryUrl.trim() || demoConfig.oidc.discoveryUrl
    }
    if (typeof oidc.clientId === 'string') demoConfig.oidc.clientId = oidc.clientId.trim() || demoConfig.oidc.clientId
    if (
      typeof oidc.clientSecret === 'string' &&
      oidc.clientSecret.trim() &&
      oidc.clientSecret !== '••••••••'
    ) {
      demoConfig.oidc.clientSecret = oidc.clientSecret
    }
  }
}

export function listDemoImapMailboxes() {
  return [...demoMailboxes]
}

export function getDemoImapMailboxes() {
  return listDemoImapMailboxes()
}

export function getDemoUnreadCounts() {
  return Object.fromEntries(
    demoMailboxes.map((mailbox) => [
      mailbox.path,
      demoMessages.filter(
        (message) => message.mailbox === mailbox.path && !JSON.parse(message.flags).includes('\\Seen')
      ).length
    ])
  ) as Record<string, number>
}

export function getDemoUnreadCount(mailbox = demoConfig.imap.mailbox) {
  return demoMessages.filter(
    (message) => message.mailbox === mailbox && !JSON.parse(message.flags).includes('\\Seen')
  ).length
}

export function getDemoSyncSummary() {
  return {
    syncing: false,
    configured: true,
    hasError: false,
    lastSyncedAt: new Date().toISOString(),
    errorMessage: null,
    progress: null
  }
}

export function getDemoMailboxSyncStatus(mailboxPath: string) {
  const storedCount = demoMessages.filter((message) => message.mailbox === mailboxPath).length
  return {
    mailbox: mailboxPath,
    configured: true,
    skipped: true,
    syncing: false,
    fetchedCount: storedCount,
    storedCount,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    reason: 'Demo data is preloaded.'
  }
}

export function listDemoStoredMessages(mailboxPath: string, limit = 100, offset = 0) {
  return sortedMessages(demoMessages.filter((message) => message.mailbox === mailboxPath)).slice(
    offset,
    offset + limit
  )
}

export function countDemoStoredMessages(mailboxPath: string) {
  return demoMessages.filter((message) => message.mailbox === mailboxPath).length
}

export function listDemoStoredThreads(mailboxPath: string, limit = 100, offset = 0) {
  const mailboxMessages = demoMessages.filter((message) => message.mailbox === mailboxPath)
  const byThread = new Map<string, DemoMailRow[]>()
  for (const message of mailboxMessages) {
    const key = message.threadId ?? message.messageId
    const bucket = byThread.get(key) ?? []
    bucket.push(message)
    byThread.set(key, bucket)
  }

  const rows = sortedMessages(
    [...byThread.values()].map((messages) =>
      sortedMessages(messages)[0]
    )
  ).map((message) => ({
    ...message,
    threadCount: byThread.get(message.threadId ?? message.messageId)?.length ?? 1
  }))

  return rows.slice(offset, offset + limit)
}

export function countDemoStoredThreads(mailboxPath: string) {
  return new Set(
    demoMessages
      .filter((message) => message.mailbox === mailboxPath)
      .map((message) => message.threadId ?? message.messageId)
  ).size
}

export function getDemoMessagesInThread(threadKey: string, mailboxPath: string) {
  const threadMessages = demoMessages.filter((message) => (message.threadId ?? message.messageId) === threadKey)
  return [...threadMessages].sort((left, right) => {
    const leftTime = left.receivedAt?.getTime() ?? 0
    const rightTime = right.receivedAt?.getTime() ?? 0
    if (leftTime !== rightTime) return leftTime - rightTime
    if (left.mailbox === mailboxPath && right.mailbox !== mailboxPath) return -1
    if (right.mailbox === mailboxPath && left.mailbox !== mailboxPath) return 1
    return left.uid - right.uid
  })
}

export function splitDemoThreadFromMessage(threadKey: string, mailboxPath: string, mailboxEntryId: number) {
  const current = getDemoMessagesInThread(threadKey, mailboxPath).filter(
    (message) => message.mailbox === mailboxPath
  )
  const splitIndex = current.findIndex((message) => message.id === mailboxEntryId)
  if (splitIndex <= 0) return null
  const splitMessages = current.slice(splitIndex)
  if (splitMessages.length === 0 || splitMessages.length === current.length) return null

  const newThreadKey = `${splitMessages[0].messageId}#split-${randomUUID()}`
  const splitIds = new Set(splitMessages.map((message) => message.messageId))
  demoMessages = demoMessages.map((message) =>
    splitIds.has(message.messageId) ? { ...message, threadId: newThreadKey } : message
  )

  return {
    threadKey: newThreadKey,
    splitCount: splitMessages.length,
    remainingCount: current.length - splitMessages.length
  }
}

export function searchDemoMessages(query: string, limit: number, offset: number) {
  const matcher = new RegExp(escapeRegExp(query.trim()), 'i')
  const results = sortedMessages(
    demoMessages.filter(
      (message) =>
        matcher.test(message.subject) ||
        matcher.test(message.from) ||
        matcher.test(message.to) ||
        matcher.test(message.textContent)
    )
  )

  const seen = new Set<string>()
  const deduped = results.filter((message) => {
    if (seen.has(message.messageId)) return false
    seen.add(message.messageId)
    return true
  })

  return deduped.slice(offset, offset + limit)
}

export function countDemoSearchMessages(query: string) {
  return searchDemoMessages(query, Number.MAX_SAFE_INTEGER, 0).length
}

export function getDemoStoredMessageById(id: string | number) {
  const numericId = typeof id === 'string' ? Number.parseInt(id, 10) : id
  return demoMessages.find((message) => message.id === numericId) ?? null
}

export function markDemoMessageAsRead(message: Pick<DemoMailRow, 'id'>) {
  demoMessages = demoMessages.map((row) => {
    if (row.id !== message.id) return row
    const flags = JSON.parse(row.flags) as string[]
    return flags.includes('\\Seen') ? row : { ...row, flags: JSON.stringify([...flags, '\\Seen']) }
  })
}

export function markDemoMessageAsUnread(message: Pick<DemoMailRow, 'id'>) {
  demoMessages = demoMessages.map((row) => {
    if (row.id !== message.id) return row
    const flags = JSON.parse(row.flags) as string[]
    return { ...row, flags: JSON.stringify(flags.filter((flag) => flag !== '\\Seen')) }
  })
}

export function markDemoMessagesSeen(ids: number[], seen: boolean) {
  let count = 0
  for (const id of ids) {
    const message = getDemoStoredMessageById(id)
    if (!message) continue
    const flags = JSON.parse(message.flags) as string[]
    const hasSeen = flags.includes('\\Seen')
    if (hasSeen === seen) continue
    count++
    if (seen) markDemoMessageAsRead(message)
    else markDemoMessageAsUnread(message)
  }
  return count
}

export function moveDemoMessage(message: Pick<DemoMailRow, 'id' | 'mailbox'>, action: 'archive' | 'trash' | 'spam' | 'inbox') {
  const targetMailbox =
    action === 'archive' ? 'Archive' : action === 'trash' ? 'Trash' : action === 'spam' ? 'Spam' : 'Inbox'
  if (targetMailbox === message.mailbox) return null
  demoMessages = demoMessages.map((row) =>
    row.id === message.id ? { ...row, mailbox: targetMailbox } : row
  )
  return targetMailbox
}

export function createDemoShareToken(mailboxEntryId: number) {
  const message = getDemoStoredMessageById(mailboxEntryId)
  if (!message) return null
  const token = randomUUID()
  demoShares.set(token, message.messageId)
  return token
}

export function getDemoMessageByShareToken(token: string) {
  const messageId = demoShares.get(token)
  if (!messageId) return null
  return demoMessages.find((message) => message.messageId === messageId) ?? null
}

export function listDemoAttachmentsForMessage(messageId: string) {
  return demoAttachments
    .filter((attachment) => attachment.messageId === messageId)
    .map(({ id, filename, contentType, size }) => ({ id, filename, contentType, size }))
}

export function listDemoAttachmentsForMessages(messageIds: string[]) {
  const allowed = new Set(messageIds)
  return demoAttachments
    .filter((attachment) => allowed.has(attachment.messageId))
    .map(({ id, messageId, filename, contentType, size }) => ({
      id,
      messageId,
      filename,
      contentType,
      size
    }))
}

export function getDemoAttachment(id: number) {
  return demoAttachments.find((attachment) => attachment.id === id) ?? null
}

export function getDemoSharedAttachment(token: string, id: number) {
  const message = getDemoMessageByShareToken(token)
  if (!message) return null
  const attachment = getDemoAttachment(id)
  if (!attachment || attachment.messageId !== message.messageId) return null
  return attachment
}

export async function upsertDemoContacts(inputs: ContactInput[]) {
  for (const input of inputs) {
    const email = normalizeEmail(input.email)
    if (!email) continue
    const existing = demoContacts.find((contact) => contact.email === email)
    const useCount = Math.max(0, input.useCount ?? 1)
    const lastUsedAt = input.lastUsedAt ?? (useCount > 0 ? new Date() : null)
    if (existing) {
      existing.name = input.name.trim() || existing.name
      existing.source = existing.source === 'manual' ? 'manual' : (input.source ?? 'auto')
      existing.useCount += useCount
      existing.lastUsedAt =
        existing.lastUsedAt && lastUsedAt && existing.lastUsedAt > lastUsedAt
          ? existing.lastUsedAt
          : (lastUsedAt ?? existing.lastUsedAt)
      existing.updatedAt = new Date()
      continue
    }

    demoContacts.push({
      id: nextContactId++,
      name: input.name.trim(),
      email,
      source: input.source ?? 'auto',
      useCount,
      lastUsedAt,
      updatedAt: new Date()
    })
  }
}

export function listDemoContacts(query = '', limit = 50) {
  const q = query.trim().toLowerCase()
  return demoContacts
    .filter(
      (contact) =>
        !q || contact.email.toLowerCase().includes(q) || contact.name.toLowerCase().includes(q)
    )
    .sort((left, right) => {
      if (right.useCount !== left.useCount) return right.useCount - left.useCount
      const leftTime = left.lastUsedAt?.getTime() ?? 0
      const rightTime = right.lastUsedAt?.getTime() ?? 0
      if (rightTime !== leftTime) return rightTime - leftTime
      return left.email.localeCompare(right.email)
    })
    .slice(0, limit)
    .map(serializeContactRow)
}

export function findDemoContactByEmail(email: string) {
  const contact = demoContacts.find((row) => row.email === normalizeEmail(email))
  return contact ? serializeContactRow(contact) : null
}

export async function importDemoContactsFromMessages() {
  const contacts = demoMessages.flatMap((message) =>
    parseAddressFields([message.from, message.to, message.cc, message.replyTo]).map((contact) => ({
      ...contact,
      source: 'auto' as const,
      useCount: 1,
      lastUsedAt: message.receivedAt
    }))
  )
  await upsertDemoContacts(contacts)
  return contacts.length
}

export function updateDemoContact(id: number, values: { name: string; email: string }) {
  const contact = demoContacts.find((row) => row.id === id)
  if (!contact) return null
  contact.name = values.name
  contact.email = normalizeEmail(values.email)
  contact.source = 'manual'
  contact.updatedAt = new Date()
  return serializeContactRow(contact)
}

export function deleteDemoContact(id: number) {
  demoContacts = demoContacts.filter((contact) => contact.id !== id)
}

export function listDemoDrafts() {
  return [...demoDrafts].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
}

export function getDemoDraft(id: number) {
  return demoDrafts.find((draft) => draft.id === id) ?? null
}

export function saveDemoDraft(body: Record<string, unknown>, serializedAttachments: string) {
  const now = new Date()
  const id = typeof body.id === 'number' ? body.id : null
  const values = {
    toAddr: typeof body.to === 'string' ? body.to : '',
    cc: typeof body.cc === 'string' ? body.cc : '',
    bcc: typeof body.bcc === 'string' ? body.bcc : '',
    subject: typeof body.subject === 'string' ? body.subject : '',
    html: typeof body.html === 'string' ? body.html : '',
    attachments: serializedAttachments,
    inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : null
  }

  if (id !== null) {
    const existing = getDemoDraft(id)
    if (existing) {
      Object.assign(existing, values, { updatedAt: now })
      return { id, updatedAt: now.toISOString() }
    }
  }

  const draft = { id: nextDraftId++, createdAt: now, updatedAt: now, ...values }
  demoDrafts.unshift(draft)
  return { id: draft.id, updatedAt: now.toISOString() }
}

export function deleteDemoDraft(id: number) {
  demoDrafts = demoDrafts.filter((draft) => draft.id !== id)
}

export function listDemoFilters() {
  return [...demoFilters].sort((left, right) => left.sortOrder - right.sortOrder)
}

export function createDemoFilter(body: Record<string, unknown>) {
  const filter: DemoFilter = {
    id: nextFilterId++,
    field: String(body.field ?? ''),
    operator: String(body.operator ?? ''),
    value: String(body.value ?? ''),
    action: String(body.action ?? ''),
    target: typeof body.target === 'string' ? body.target : null,
    enabled: body.enabled !== false,
    sortOrder: typeof body.sort_order === 'number' ? body.sort_order : demoFilters.length
  }
  demoFilters.push(filter)
  return filter.id
}

export function updateDemoFilter(id: number, body: Record<string, unknown>) {
  const filter = demoFilters.find((row) => row.id === id)
  if (!filter) return
  if (typeof body.field === 'string') filter.field = body.field
  if (typeof body.operator === 'string') filter.operator = body.operator
  if (typeof body.value === 'string') filter.value = body.value
  if (typeof body.action === 'string') filter.action = body.action
  if (body.target !== undefined) filter.target = typeof body.target === 'string' ? body.target : null
  if (typeof body.enabled === 'boolean') filter.enabled = body.enabled
  if (typeof body.sort_order === 'number') filter.sortOrder = body.sort_order
}

export function deleteDemoFilter(id: number) {
  demoFilters = demoFilters.filter((filter) => filter.id !== id)
}

export function reorderDemoFilters(ids: number[]) {
  for (let index = 0; index < ids.length; index++) {
    const filter = demoFilters.find((row) => row.id === ids[index])
    if (filter) filter.sortOrder = index
  }
}

export async function sendDemoMessage(payload: {
  to: string
  cc?: string
  bcc?: string
  subject: string
  html?: string
  inReplyTo?: string
  attachments: Array<{ name: string; contentType: string; contentBase64: string; size: number }>
}) {
  const receivedAt = new Date()
  const textContent = stripHtml(payload.html ?? '') || payload.subject
  const messageId = `<demo-sent-${randomUUID()}@mail.local>`
  const threadId = payload.inReplyTo ?? messageId
  const message: DemoMailRow = {
    id: nextMessageId++,
    messageId,
    mailbox: 'Sent',
    uid: nextMessageId + 1000,
    flags: '["\\\\Seen"]',
    subject: payload.subject,
    from: demoConfig.smtp.from,
    to: payload.to,
    cc: payload.cc ?? '',
    preview: textContent.slice(0, 240),
    receivedAt,
    threadId,
    textContent,
    htmlContent: payload.html ?? null,
    replyTo: 'demo@example.com',
    inReplyTo: payload.inReplyTo ?? null,
    references: payload.inReplyTo ?? null
  }

  demoMessages.unshift(message)

  for (const attachment of payload.attachments) {
    demoAttachments.push({
      id: nextAttachmentId++,
      messageId,
      filename: attachment.name,
      contentType: attachment.contentType,
      content: Buffer.from(attachment.contentBase64, 'base64'),
      size: attachment.size
    })
  }

  await upsertDemoContacts(
    parseAddressFields([payload.to, payload.cc, payload.bcc]).map((contact) => ({
      ...contact,
      source: 'auto' as const,
      useCount: 1,
      lastUsedAt: receivedAt
    }))
  )

  return message
}

export function getDemoVapidPublicKey() {
  return null
}

export function generateDemoVapidKeys() {
  return { publicKey: 'demo-mode-disabled', subject: 'Demo mode disables live push delivery.' }
}

export function generateDemoAiCompose(input: {
  mode: string
  subject: string
  html: string
  to: string
}) {
  const subject = input.subject || 'Follow-up'
  const body = textPreview(input.html, 'Thanks for the update. Here is a polished version for the demo.')
  const opener = /reply/i.test(input.mode)
    ? 'Thanks for the note.'
    : input.to
      ? `Hello ${input.to.split(',')[0]?.split('<')[0]?.trim() || 'there'},`
      : 'Hello,'

  return [
    `<p>${opener}</p>`,
    `<p>${body}</p>`,
    `<p>To keep demo mode realistic, this draft is pre-generated and does not call a live AI service.</p>`,
    `<p>Please let me know if you would like any changes to <strong>${subject}</strong>.</p>`
  ].join('')
}

export function generateDemoRecentSummary(mailboxPath: string, targetLanguage: string, limit: number) {
  const messages = listDemoStoredMessages(mailboxPath, limit, 0)
  if (messages.length === 0) return 'No recent mail to summarize.'

  if (looksKorean(targetLanguage)) {
    return [
      `데모 요약: 최근 ${messages.length}개의 메일을 기반으로 생성된 미리 준비된 결과입니다.`,
      `- 우선순위 높음: ${messages[0]?.subject ?? '새 메일'} 확인 필요`,
      `- 진행 중인 대화: ${messages
        .slice(0, 3)
        .map((message) => message.subject)
        .join(', ')}`,
      '- 참고: 데모 모드에서는 OpenAI를 호출하지 않고 고정된 요약을 보여줍니다.'
    ].join('\n')
  }

  return [
    `Demo summary: pre-generated from the latest ${messages.length} messages.`,
    `- Highest priority: review "${messages[0]?.subject ?? 'new mail'}"`,
    `- Active conversations: ${messages
      .slice(0, 3)
      .map((message) => message.subject)
      .join(', ')}`,
    '- Note: demo mode does not call a live AI service.'
  ].join('\n')
}

export function generateDemoThreadSummary(
  mailboxPath: string,
  threadId: string,
  targetLanguage: string
) {
  const messages = getDemoMessagesInThread(threadId, mailboxPath)
  if (messages.length === 0) return null

  const participants = Array.from(new Set(messages.map((message) => message.from))).join(', ')
  const latest = messages[messages.length - 1]

  if (looksKorean(targetLanguage)) {
    return [
      `요약: "${latest.subject}" 스레드는 ${messages.length}개의 메시지로 구성됩니다.`,
      `- 참여자: ${participants}`,
      `- 현재 상태: 최신 메시지는 "${latest.preview}" 입니다.`,
      '- 후속 조치: 데모 화면에서 답장, 전달, 스레드 분리 기능을 계속 시험할 수 있습니다.',
      '- 참고: 이 요약은 데모용으로 미리 생성되었습니다.'
    ].join('\n')
  }

  return [
    `Summary: "${latest.subject}" contains ${messages.length} messages.`,
    `- Participants: ${participants}`,
    `- Current status: the latest update says "${latest.preview}"`,
    '- Follow-up: you can continue testing reply, forward, and split-thread actions in demo mode.',
    '- Note: this summary is pre-generated for the demo.'
  ].join('\n')
}

export function generateDemoTranslations(segments: string[], targetLanguage: string) {
  const korean = looksKorean(targetLanguage)
  return segments.map((segment) => {
    const text = segment.trim()
    if (!text) return segment
    if (korean) return `[데모 번역] ${text}`
    return `[Demo ${targetLanguage}] ${text}`
  })
}
