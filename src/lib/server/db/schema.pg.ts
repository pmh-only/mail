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
  imapAllowInvalidCertificate: boolean('imap_allow_invalid_certificate'),
  imapUser: text('imap_user'),
  imapPassword: text('imap_password'),
  imapMailbox: text('imap_mailbox'),
  imapPollSeconds: integer('imap_poll_seconds'),
  imapServers: jsonb('imap_servers'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpSecure: boolean('smtp_secure'),
  smtpAllowInvalidCertificate: boolean('smtp_allow_invalid_certificate'),
  smtpUser: text('smtp_user'),
  smtpPassword: text('smtp_password'),
  smtpFrom: text('smtp_from'),
  smtpServers: jsonb('smtp_servers'),
  smtpUndoSendSeconds: integer('smtp_undo_send_seconds').notNull().default(0),
  authSetupComplete: boolean('auth_setup_complete').notNull().default(false),
  authUserId: text('auth_user_id'),
  githubClientId: text('github_client_id'),
  githubClientSecret: text('github_client_secret'),
  discordClientId: text('discord_client_id'),
  discordClientSecret: text('discord_client_secret'),
  oidcIssuer: text('oidc_issuer'),
  oidcAuthorizationUrl: text('oidc_authorization_url'),
  oidcTokenUrl: text('oidc_token_url'),
  oidcUserInfoUrl: text('oidc_user_info_url'),
  // Retained so existing installations can sign in while migrating to manual endpoints.
  oidcDiscoveryUrl: text('oidc_discovery_url'),
  oidcClientId: text('oidc_client_id'),
  oidcClientSecret: text('oidc_client_secret'),
  oidcSubject: text('oidc_subject'),
  oidcSubjectDiscoveryUrl: text('oidc_subject_discovery_url'),
  openaiApiKey: text('openai_api_key'),
  openaiModel: text('openai_model'),
  openaiImportanceClassification: boolean('openai_importance_classification'),
  signature: text('signature'),
  vapidPublicKey: text('vapid_public_key'),
  vapidPrivateKey: text('vapid_private_key'),
  vapidSubject: text('vapid_subject'),
  quietHoursEnabled: boolean('quiet_hours_enabled'),
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  quietHoursTimezone: text('quiet_hours_timezone'),
  preferences: jsonb('preferences'),
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

export const openPgpKey = pgTable(
  'openpgp_key',
  {
    id: serial('id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    name: text('name').notNull().default(''),
    email: text('email').notNull().default(''),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key'),
    passphrase: text('passphrase'),
    isOwn: boolean('is_own').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    encryptionEmail: text('encryption_email'),
    encryptionConfirmedAt: timestamp('encryption_confirmed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    encryptionSource: text('encryption_source'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('openpgp_key_fingerprint_idx').on(table.fingerprint),
    index('openpgp_key_email_idx').on(table.email),
    index('openpgp_key_own_default_idx').on(table.isOwn, table.isDefault)
  ]
)

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
  configId: text('config_id'),
  remotePath: text('remote_path'),
  name: text('name').notNull(),
  delimiter: text('delimiter').notNull().default('/'),
  specialUse: text('special_use'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
})

export const composedMailbox = pgTable(
  'composed_mailbox',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon').notNull().default('layers'),
    mailboxPaths: jsonb('mailbox_paths').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('composed_mailbox_name_idx').on(table.name),
    uniqueIndex('composed_mailbox_slug_idx').on(table.slug)
  ]
)

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
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    rawMessage: bytea('raw_message'),
    messageId: text('message_id'),
    trackingToken: text('tracking_token'),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }),
    readNotificationSentAt: timestamp('read_notification_sent_at', {
      withTimezone: true,
      mode: 'date'
    }),
    readNotificationAttemptCount: integer('read_notification_attempt_count').notNull().default(0),
    readNotificationAvailableAt: timestamp('read_notification_available_at', {
      withTimezone: true,
      mode: 'date'
    }),
    readNotificationClaimedAt: timestamp('read_notification_claimed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    sentMailbox: text('sent_mailbox'),
    placeholderActive: boolean('placeholder_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('smtp_job_status_available_at_idx').on(table.status, table.availableAt),
    index('smtp_job_message_id_idx').on(table.messageId),
    uniqueIndex('smtp_job_tracking_token_idx').on(table.trackingToken),
    index('smtp_job_read_notification_pending_idx').on(
      table.readNotificationSentAt,
      table.readNotificationAvailableAt
    ),
    index('smtp_job_placeholder_mailbox_status_created_at_idx').on(
      table.placeholderActive,
      table.sentMailbox,
      table.status,
      table.createdAt
    )
  ]
)

export const mailMessage = pgTable(
  'mail_message',
  {
    id: serial('id').primaryKey(),
    configId: text('config_id').notNull().default('primary'),
    messageId: text('message_id').notNull(),
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
    aiImportant: boolean('ai_important').notNull().default(false),
    aiImportanceClassifiedAt: timestamp('ai_importance_classified_at', {
      withTimezone: true,
      mode: 'date'
    }),
    aiImportanceAttempts: integer('ai_importance_attempts').notNull().default(0),
    aiImportanceClaimedAt: timestamp('ai_importance_claimed_at', {
      withTimezone: true,
      mode: 'date'
    }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
    orphanedAt: timestamp('orphaned_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    index('mail_message_thread_id_idx').on(table.threadId),
    index('mail_message_thread_key_idx').on(table.threadKey),
    uniqueIndex('mail_message_config_message_id_idx').on(table.configId, table.messageId),
    index('mail_message_orphaned_at_idx').on(table.orphanedAt)
  ]
)

export const mailMessageMailbox = pgTable(
  'mail_message_mailbox',
  {
    id: serial('id').primaryKey(),
    configId: text('config_id').notNull().default('primary'),
    mailMessageId: integer('mail_message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    mailbox: text('mailbox').notNull(),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    uidValidity: bigint('uid_validity', { mode: 'number' }),
    flags: text('flags').notNull().default('[]'),
    rawSource: bytea('raw_source'),
    rawSourceCheckedAt: timestamp('raw_source_checked_at', { withTimezone: true, mode: 'date' }),
    rawSourceAttempts: integer('raw_source_attempts').notNull().default(0),
    rawSourceNextAttemptAt: timestamp('raw_source_next_attempt_at', {
      withTimezone: true,
      mode: 'date'
    }),
    spfStatus: text('spf_status'),
    dkimStatus: text('dkim_status'),
    dmarcStatus: text('dmarc_status'),
    authservId: text('authserv_id'),
    openPgpSigned: boolean('openpgp_signed').notNull().default(false),
    openPgpSignatureStatus: text('openpgp_signature_status'),
    openPgpSigner: text('openpgp_signer'),
    openPgpFingerprint: text('openpgp_fingerprint'),
    openPgpEncrypted: boolean('openpgp_encrypted').notNull().default(false),
    openPgpDecrypted: boolean('openpgp_decrypted').notNull().default(false),
    openPgpError: text('openpgp_error'),
    openPgpProcessedAt: timestamp('openpgp_processed_at', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'date' }),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('mail_message_mailbox_mailbox_uid_idx').on(table.mailbox, table.uid),
    index('mail_message_mailbox_message_id_idx').on(table.messageId),
    index('mail_message_mailbox_mail_message_id_idx').on(table.mailMessageId),
    index('mail_message_mailbox_mailbox_received_at_uid_idx').on(
      table.mailbox,
      table.receivedAt,
      table.uid
    ),
    index('mail_message_mailbox_mailbox_snoozed_until_idx').on(table.mailbox, table.snoozedUntil),
    index('mail_message_mailbox_openpgp_processed_at_idx').on(table.openPgpProcessedAt)
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

export const mailShare = pgTable(
  'mail_share',
  {
    token: text('token').primaryKey(),
    messageId: text('message_id').notNull(),
    messageIds: text('message_ids'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [index('mail_share_message_id_idx').on(table.messageId)]
)

export const mailAttachment = pgTable(
  'mail_attachment',
  {
    id: serial('id').primaryKey(),
    mailMessageId: integer('mail_message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    filename: text('filename').notNull().default(''),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: integer('size').notNull().default(0),
    content: bytea('content').notNull()
  },
  (table) => [
    index('mail_attachment_message_id_idx').on(table.messageId),
    index('mail_attachment_mail_message_id_idx').on(table.mailMessageId)
  ]
)

export const publicAttachment = pgTable('public_attachment', {
  token: text('token').primaryKey(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull().default('application/octet-stream'),
  size: integer('size').notNull(),
  content: bytea('content'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' })
})

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
  smtpServerId: text('smtp_server_id'),
  fromName: text('from_name'),
  openPgpSigning: text('openpgp_signing').notNull().default('none'),
  openPgpEncrypt: boolean('openpgp_encrypt').notNull().default(false),
  attachPublicKey: boolean('attach_public_key').notNull().default(false),
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
  readControlVersion: integer('read_control_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
})
