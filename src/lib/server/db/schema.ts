import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Stores IMAP and SMTP configuration (single row, id=1).
// Values here take priority over environment variables.
export const mailConfig = sqliteTable('mail_config', {
  id: integer('id').primaryKey().default(1),
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  imapSecure: integer('imap_secure', { mode: 'boolean' }),
  imapUser: text('imap_user'),
  imapPassword: text('imap_password'),
  imapMailbox: text('imap_mailbox'),
  imapPollSeconds: integer('imap_poll_seconds'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpSecure: integer('smtp_secure', { mode: 'boolean' }),
  smtpUser: text('smtp_user'),
  smtpPassword: text('smtp_password'),
  smtpFrom: text('smtp_from'),
  oidcDiscoveryUrl: text('oidc_discovery_url'),
  oidcClientId: text('oidc_client_id'),
  oidcClientSecret: text('oidc_client_secret'),
  signature: text('signature'),
  vapidPublicKey: text('vapid_public_key'),
  vapidPrivateKey: text('vapid_private_key'),
  vapidSubject: text('vapid_subject'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
})

export const mailboxSync = sqliteTable('mailbox_sync', {
  mailbox: text('mailbox').primaryKey(),
  lastUid: integer('last_uid').notNull().default(0),
  historyComplete: integer('history_complete', { mode: 'boolean' }).notNull().default(false),
  lastFetchedCount: integer('last_fetched_count').notNull().default(0),
  lastStoredCount: integer('last_stored_count').notNull().default(0),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error')
})

// Stores unique message content, keyed by Message-ID header
export const mailMessage = sqliteTable('mail_message', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject').notNull().default(''),
  from: text('from').notNull().default(''),
  to: text('to').notNull().default(''),
  cc: text('cc').notNull().default(''),
  preview: text('preview').notNull().default(''),
  textContent: text('text_content').notNull().default(''),
  htmlContent: text('html_content'),
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  threadId: text('thread_id'),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' })
})

// Stores per-mailbox presence of a message (uid, flags)
export const mailMessageMailbox = sqliteTable(
  'mail_message_mailbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: text('message_id').notNull(),
    mailbox: text('mailbox').notNull(),
    uid: integer('uid').notNull(),
    flags: text('flags').notNull().default('[]'),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => [
    uniqueIndex('mail_message_mailbox_mailbox_uid_idx').on(table.mailbox, table.uid),
    index('mail_message_mailbox_message_id_idx').on(table.messageId)
  ]
)

export const mailShare = sqliteTable('mail_share', {
  token: text('token').primaryKey(),
  messageId: text('message_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
})

export const mailAttachment = sqliteTable(
  'mail_attachment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: text('message_id').notNull(),
    filename: text('filename').notNull().default(''),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: integer('size').notNull().default(0),
    content: blob('content').notNull()
  },
  (table) => [index('mail_attachment_message_id_idx').on(table.messageId)]
)

export const mailDraft = sqliteTable('mail_draft', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  toAddr: text('to_addr').notNull().default(''),
  cc: text('cc').notNull().default(''),
  bcc: text('bcc').notNull().default(''),
  subject: text('subject').notNull().default(''),
  html: text('html').notNull().default(''),
  inReplyTo: text('in_reply_to')
})

export const mailFilter = sqliteTable('mail_filter', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  field: text('field').notNull(), // 'from' | 'to' | 'subject' | 'cc'
  operator: text('operator').notNull(), // 'contains' | 'equals' | 'starts_with'
  value: text('value').notNull(),
  action: text('action').notNull(), // 'move' | 'mark_read' | 'trash'
  target: text('target') // target mailbox path for 'move'
})

export const mailPushSubscription = sqliteTable('mail_push_subscription', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
})

export * from './auth.schema'
