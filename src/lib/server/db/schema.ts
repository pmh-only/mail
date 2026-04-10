import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const mailboxSync = sqliteTable('mailbox_sync', {
	mailbox: text('mailbox').primaryKey(),
	lastUid: integer('last_uid').notNull().default(0),
	lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
	lastError: text('last_error')
});

export const mailMessage = sqliteTable(
	'mail_message',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		mailbox: text('mailbox').notNull(),
		uid: integer('uid').notNull(),
		messageId: text('message_id'),
		subject: text('subject').notNull().default(''),
		from: text('from').notNull().default(''),
		to: text('to').notNull().default(''),
		preview: text('preview').notNull().default(''),
		textContent: text('text_content').notNull().default(''),
		htmlContent: text('html_content'),
		flags: text('flags').notNull().default('[]'),
		receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
		syncedAt: integer('synced_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [uniqueIndex('mail_message_mailbox_uid_idx').on(table.mailbox, table.uid)]
);

export * from './auth.schema';
