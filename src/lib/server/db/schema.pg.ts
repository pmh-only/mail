import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  serial,
  customType
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  }
})

export const mailConfig = pgTable('mail_config', {
  id: integer('id').primaryKey().default(1),
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  imapSecure: boolean('imap_secure'),
  imapUser: text('imap_user'),
  imapPassword: text('imap_password'),
  imapMailbox: text('imap_mailbox'),
  imapPollSeconds: integer('imap_poll_seconds'),
  imapServers: jsonb('imap_servers'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpSecure: boolean('smtp_secure'),
  smtpUser: text('smtp_user'),
  smtpPassword: text('smtp_password'),
  smtpFrom: text('smtp_from'),
  smtpServers: jsonb('smtp_servers'),
  smtpUndoSendSeconds: integer('smtp_undo_send_seconds').notNull().default(0),
  oidcDiscoveryUrl: text('oidc_discovery_url'),
  oidcClientId: text('oidc_client_id'),
  oidcClientSecret: text('oidc_client_secret'),
  oidcSubject: text('oidc_subject'),
  oidcSubjectDiscoveryUrl: text('oidc_subject_discovery_url'),
  signature: text('signature'),
  vapidPublicKey: text('vapid_public_key'),
  vapidPrivateKey: text('vapid_private_key'),
  vapidSubject: text('vapid_subject'),
  quietHoursEnabled: boolean('quiet_hours_enabled'),
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  quietHoursTimezone: text('quiet_hours_timezone'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
})

export const mailSignature = pgTable('mail_signature', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  html: text('html').notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const mailboxSync = pgTable('mailbox_sync', {
  mailbox: text('mailbox').primaryKey(),
  lastUid: bigint('last_uid', { mode: 'number' }).notNull().default(0),
  uidValidity: bigint('uid_validity', { mode: 'number' }),
  highestModseq: bigint('highest_modseq', { mode: 'bigint' }),
  lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true, mode: 'date' }),
  historyComplete: boolean('history_complete').notNull().default(false),
  lastFetchedCount: integer('last_fetched_count').notNull().default(0),
  lastStoredCount: integer('last_stored_count').notNull().default(0),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error')
})

export const mailboxCatalog = pgTable('mailbox_catalog', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  delimiter: text('delimiter').notNull().default('/'),
  specialUse: text('special_use'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
})

export const syncRuntime = pgTable('sync_runtime', {
  id: integer('id').primaryKey().default(1),
  isSyncing: boolean('is_syncing').notNull().default(false),
  activeMailbox: text('active_mailbox'),
  activeStored: integer('active_stored').notNull().default(0),
  activeTotal: integer('active_total').notNull().default(0),
  lastRunStartedAt: timestamp('last_run_started_at', { withTimezone: true, mode: 'date' }),
  lastRunFinishedAt: timestamp('last_run_finished_at', { withTimezone: true, mode: 'date' }),
  workerHeartbeatAt: timestamp('worker_heartbeat_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error')
})

export const imapJob = pgTable(
  'imap_job',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    mailbox: text('mailbox').notNull(),
    uid: bigint('uid', { mode: 'number' }),
    uidValidity: bigint('uid_validity', { mode: 'number' }),
    draftId: integer('draft_id'),
    targetMailbox: text('target_mailbox'),
    status: text('status').notNull().default('pending'),
    dedupeKey: text('dedupe_key').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('imap_job_dedupe_key_idx').on(table.dedupeKey),
    index('imap_job_status_available_at_idx').on(table.status, table.availableAt)
  ]
)

export const smtpJob = pgTable(
  'smtp_job',
  {
    id: serial('id').primaryKey(),
    payload: text('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('smtp_job_status_available_at_idx').on(table.status, table.availableAt)]
)

export const mailMessage = pgTable(
  'mail_message',
  {
    id: serial('id').primaryKey(),
    messageId: text('message_id').notNull().unique(),
    subject: text('subject').notNull().default(''),
    from: text('from').notNull().default(''),
    to: text('to').notNull().default(''),
    cc: text('cc').notNull().default(''),
    replyTo: text('reply_to'),
    preview: text('preview').notNull().default(''),
    textContent: text('text_content').notNull().default(''),
    htmlContent: text('html_content'),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    threadId: text('thread_id'),
    threadKey: text('thread_key').notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    index('mail_message_thread_id_idx').on(table.threadId),
    index('mail_message_thread_key_idx').on(table.threadKey)
  ]
)

export const mailMessageMailbox = pgTable(
  'mail_message_mailbox',
  {
    id: serial('id').primaryKey(),
    messageId: text('message_id').notNull(),
    mailbox: text('mailbox').notNull(),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    flags: text('flags').notNull().default('[]'),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'date' }),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('mail_message_mailbox_mailbox_uid_idx').on(table.mailbox, table.uid),
    index('mail_message_mailbox_message_id_idx').on(table.messageId),
    index('mail_message_mailbox_mailbox_received_at_uid_idx').on(
      table.mailbox,
      table.receivedAt,
      table.uid
    ),
    index('mail_message_mailbox_mailbox_snoozed_until_idx').on(table.mailbox, table.snoozedUntil)
  ]
)

export const mailThreadSummary = pgTable(
  'mail_thread_summary',
  {
    mailbox: text('mailbox').notNull(),
    threadKey: text('thread_key').notNull(),
    representativeMailboxEntryId: integer('representative_mailbox_entry_id').notNull(),
    threadCount: integer('thread_count').notNull(),
    latestUid: bigint('latest_uid', { mode: 'number' }).notNull(),
    latestReceivedAt: timestamp('latest_received_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('mail_thread_summary_mailbox_thread_key_idx').on(table.mailbox, table.threadKey),
    index('mail_thread_summary_mailbox_latest_received_at_uid_idx').on(
      table.mailbox,
      table.latestReceivedAt,
      table.latestUid
    )
  ]
)

export const mailThreadMetadata = pgTable(
  'mail_thread_metadata',
  {
    id: serial('id').primaryKey(),
    mailbox: text('mailbox').notNull(),
    threadKey: text('thread_key').notNull(),
    starred: boolean('starred').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('mail_thread_metadata_mailbox_thread_key_idx').on(table.mailbox, table.threadKey),
    index('mail_thread_metadata_mailbox_starred_idx').on(table.mailbox, table.starred),
    index('mail_thread_metadata_mailbox_pinned_idx').on(table.mailbox, table.pinned)
  ]
)

export const mailThreadNote = pgTable(
  'mail_thread_note',
  {
    threadKey: text('thread_key').primaryKey(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('mail_thread_note_updated_at_idx').on(table.updatedAt)]
)

export const mailShare = pgTable('mail_share', {
  token: text('token').primaryKey(),
  messageId: text('message_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
})

export const mailAttachment = pgTable(
  'mail_attachment',
  {
    id: serial('id').primaryKey(),
    messageId: text('message_id').notNull(),
    filename: text('filename').notNull().default(''),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: integer('size').notNull().default(0),
    content: bytea('content').notNull()
  },
  (table) => [index('mail_attachment_message_id_idx').on(table.messageId)]
)

export const mailAttachmentSummary = pgTable('mail_attachment_summary', {
  id: serial('id').primaryKey(),
  attachmentId: integer('attachment_id').notNull().unique(),
  contentFingerprint: text('content_fingerprint').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const mailDraft = pgTable('mail_draft', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  toAddr: text('to_addr').notNull().default(''),
  cc: text('cc').notNull().default(''),
  bcc: text('bcc').notNull().default(''),
  subject: text('subject').notNull().default(''),
  html: text('html').notNull().default(''),
  attachments: text('attachments').notNull().default('[]'),
  inReplyTo: text('in_reply_to'),
  imapMailbox: text('imap_mailbox'),
  imapUid: bigint('imap_uid', { mode: 'number' }),
  imapUidValidity: bigint('imap_uid_validity', { mode: 'number' }),
  imapSyncedAt: timestamp('imap_synced_at', { withTimezone: true, mode: 'date' }),
  imapSyncError: text('imap_sync_error')
})

export const mailContact = pgTable(
  'mail_contact',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    source: text('source').notNull().default('auto'),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('mail_contact_email_idx').on(table.email),
    index('mail_contact_last_used_at_idx').on(table.lastUsedAt),
    index('mail_contact_use_count_idx').on(table.useCount)
  ]
)

export const mailSenderRule = pgTable(
  'mail_sender_rule',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    sender: text('sender').notNull(),
    normalizedSender: text('normalized_sender').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('mail_sender_rule_type_normalized_sender_idx').on(
      table.type,
      table.normalizedSender
    ),
    index('mail_sender_rule_normalized_sender_idx').on(table.normalizedSender)
  ]
)

export const mailContactGroup = pgTable(
  'mail_contact_group',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [uniqueIndex('mail_contact_group_name_idx').on(table.name)]
)

export const mailContactGroupMember = pgTable(
  'mail_contact_group_member',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id').notNull(),
    contactId: integer('contact_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('mail_contact_group_member_group_contact_idx').on(table.groupId, table.contactId),
    index('mail_contact_group_member_group_id_idx').on(table.groupId),
    index('mail_contact_group_member_contact_id_idx').on(table.contactId)
  ]
)

export const mailFilter = pgTable('mail_filter', {
  id: serial('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  field: text('field').notNull(),
  operator: text('operator').notNull(),
  value: text('value').notNull(),
  conditions: jsonb('conditions'),
  action: text('action').notNull(),
  target: text('target')
})

export const mailAuditLog = pgTable(
  'mail_audit_log',
  {
    id: serial('id').primaryKey(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    actorUserId: text('actor_user_id'),
    actorEmail: text('actor_email'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    index('mail_audit_log_created_at_idx').on(table.createdAt),
    index('mail_audit_log_entity_idx').on(table.entityType, table.entityId)
  ]
)

export const mailCleanupRule = pgTable('mail_cleanup_rule', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  mailbox: text('mailbox'),
  minAgeDays: integer('min_age_days').notNull(),
  action: text('action').notNull().default('archive'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const savedSearch = pgTable('saved_search', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const messageTemplate = pgTable(
  'message_template',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    html: text('html').notNull().default(''),
    isSnippet: boolean('is_snippet').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index('message_template_name_idx').on(table.name)]
)

export const mailboxNotificationSetting = pgTable('mailbox_notification_setting', {
  mailbox: text('mailbox').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const mailPushSubscription = pgTable('mail_push_subscription', {
  id: serial('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
})
