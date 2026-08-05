import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from './schema.pg'

const tableName = Symbol.for('drizzle:Name')
const columns = Symbol.for('drizzle:Columns')
const tableColumns = {
  mailConfig: ['id', 'imapHost', 'smtpHost', 'preferences', 'updatedAt'],
  mailSignature: ['id', 'name', 'html', 'isDefault', 'createdAt', 'updatedAt'],
  openPgpKey: ['id', 'fingerprint', 'email', 'publicKey', 'isOwn'],
  mailboxSync: ['mailbox', 'lastUid', 'uidValidity', 'highestModseq', 'historyComplete'],
  mailboxCatalog: ['path', 'configId', 'remotePath', 'name', 'delimiter'],
  composedMailbox: ['id', 'name', 'slug', 'mailboxPaths', 'updatedAt'],
  syncRuntime: ['id', 'isSyncing', 'activeMailbox', 'lastError'],
  imapJob: ['id', 'type', 'mailbox', 'dedupeKey', 'availableAt'],
  smtpJob: ['id', 'payload', 'rawMessage', 'trackingToken', 'placeholderActive'],
  mailMessage: ['id', 'configId', 'messageId', 'threadKey', 'orphanedAt'],
  mailMessageMailbox: ['id', 'mailMessageId', 'mailbox', 'uid', 'rawSource'],
  mailThreadSummary: ['mailbox', 'threadKey', 'representativeMailboxEntryId', 'latestUid'],
  mailThreadMetadata: ['id', 'mailbox', 'threadKey', 'starred', 'pinned'],
  mailThreadNote: ['threadKey', 'body', 'updatedAt'],
  mailShare: ['token', 'messageId', 'messageIds', 'expiresAt', 'revokedAt'],
  mailAttachment: ['id', 'mailMessageId', 'messageId', 'filename', 'content'],
  publicAttachment: ['token', 'filename', 'contentType', 'content', 'expiresAt'],
  mailAttachmentSummary: ['id', 'attachmentId', 'contentFingerprint', 'summary'],
  mailDraft: ['id', 'toAddr', 'subject', 'attachments', 'openPgpEncrypt'],
  mailContact: ['id', 'email', 'name', 'source', 'useCount'],
  mailSenderRule: ['id', 'type', 'sender', 'normalizedSender'],
  mailContactGroup: ['id', 'name', 'description', 'updatedAt'],
  mailContactGroupMember: ['id', 'groupId', 'contactId', 'createdAt'],
  mailFilter: ['id', 'sortOrder', 'enabled', 'conditions', 'target'],
  mailAuditLog: ['id', 'action', 'entityType', 'metadata', 'createdAt'],
  mailCleanupRule: ['id', 'enabled', 'mailbox', 'minAgeDays', 'action'],
  savedSearch: ['id', 'name', 'query', 'updatedAt'],
  messageTemplate: ['id', 'name', 'subject', 'html', 'isSnippet'],
  mailboxNotificationSetting: ['mailbox', 'enabled', 'updatedAt'],
  mailPushSubscription: ['id', 'endpoint', 'p256dh', 'auth', 'readControlVersion']
} as const

describe('mail PostgreSQL schema', () => {
  it('exports each table with its expected database name and key columns', () => {
    assert.deepEqual(Object.keys(schema).sort(), Object.keys(tableColumns).sort())

    for (const [exportName, expectedColumns] of Object.entries(tableColumns)) {
      const table = schema[exportName as keyof typeof schema] as unknown as Record<
        PropertyKey,
        unknown
      >
      assert.equal(
        table[tableName],
        exportName === 'openPgpKey' ? 'openpgp_key' : expectedTableName(exportName)
      )
      const actualColumns = table[columns] as Record<string, unknown>
      for (const column of expectedColumns)
        assert.ok(actualColumns[column], `${exportName}.${column}`)
    }
  })

  it('preserves defaults, binary types, foreign keys, indexes, and update hooks', () => {
    assert.equal(schema.mailConfig.id.default, 1)
    assert.equal(schema.mailConfig.authSetupComplete.default, false)
    assert.equal(schema.mailDraft.openPgpSigning.default, 'none')
    assert.equal(schema.mailAttachment.content.getSQLType(), 'bytea')
    assert.equal(schema.smtpJob.rawMessage.getSQLType(), 'bytea')
    assert.equal(getTableConfig(schema.mailMessageMailbox).foreignKeys[0].onDelete, 'cascade')
    assert.equal(getTableConfig(schema.mailAttachment).foreignKeys[0].onDelete, 'cascade')

    assert.equal(getTableConfig(schema.smtpJob).indexes.length, 5)
    assert.equal(schema.openPgpKey.updatedAt.onUpdateFn?.() instanceof Date, true)
    assert.equal(schema.mailSignature.updatedAt.onUpdateFn?.() instanceof Date, true)

    for (const table of Object.values(schema)) {
      const config = getTableConfig(table)
      for (const foreignKey of config.foreignKeys) foreignKey.reference()
      for (const column of config.columns) column.onUpdateFn?.()
    }
  })
})

function expectedTableName(exportName: string) {
  return exportName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}
