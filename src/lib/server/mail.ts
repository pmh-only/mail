import { env } from '$env/dynamic/private';
import { desc, eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from '$lib/server/db';
import { mailboxSync, mailMessage } from '$lib/server/db/schema';

type MailConfig = {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	mailbox: string;
	pollSeconds: number;
	initialFetchCount: number;
};

export type MailRow = typeof mailMessage.$inferSelect;

export type SyncResult = {
	mailbox: string;
	configured: boolean;
	skipped: boolean;
	fetchedCount: number;
	storedCount: number;
	lastSyncedAt: string | null;
	lastError: string | null;
	reason?: string;
};

let activeSync: Promise<SyncResult> | null = null;

function parseBoolean(value: string | undefined, fallback: boolean) {
	if (value == null || value === '') return fallback;
	return value.toLowerCase() !== 'false';
}

function parseNumber(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(): MailConfig | { missing: string[]; mailbox: string } {
	const mailbox = env.IMAP_MAILBOX || 'INBOX';
	const required = {
		IMAP_HOST: env.IMAP_HOST,
		IMAP_USER: env.IMAP_USER,
		IMAP_PASSWORD: env.IMAP_PASSWORD
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);

	if (missing.length > 0) {
		return { missing, mailbox };
	}

	return {
		host: env.IMAP_HOST!,
		port: parseNumber(env.IMAP_PORT, 993),
		secure: parseBoolean(env.IMAP_SECURE, true),
		user: env.IMAP_USER!,
		password: env.IMAP_PASSWORD!,
		mailbox,
		pollSeconds: parseNumber(env.IMAP_POLL_SECONDS, 15),
		initialFetchCount: parseNumber(env.IMAP_INITIAL_FETCH_COUNT, 50)
	};
}

function summarizeAddresses(input: unknown) {
	if (!input || typeof input !== 'object' || !('value' in input)) return '';
	const addresses = (input as { value?: Array<{ name?: string; address?: string }> }).value ?? [];
	return addresses
		.map((entry) => entry.name || entry.address || '')
		.filter(Boolean)
		.join(', ');
}

function createPreview(text: string) {
	return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function readSyncState(mailbox: string) {
	const [state] = await db
		.select()
		.from(mailboxSync)
		.where(eq(mailboxSync.mailbox, mailbox))
		.limit(1);
	return state;
}

async function saveSyncState(mailbox: string, values: Partial<typeof mailboxSync.$inferInsert>) {
	await db
		.insert(mailboxSync)
		.values({ mailbox, ...values })
		.onConflictDoUpdate({
			target: mailboxSync.mailbox,
			set: values
		});
}

async function storeMessage(
	mailbox: string,
	message: Awaited<ReturnType<typeof simpleParser>>,
	uid: number,
	flags: string[],
	internalDate?: Date
) {
	const receivedAt = message.date ?? internalDate ?? null;
	const textContent = message.text?.trim() ?? '';
	const htmlContent = typeof message.html === 'string' ? message.html : null;

	await db
		.insert(mailMessage)
		.values({
			mailbox,
			uid,
			messageId: message.messageId ?? null,
			subject: message.subject?.trim() ?? '(no subject)',
			from: summarizeAddresses(message.from),
			to: summarizeAddresses(message.to),
			preview: createPreview(textContent),
			textContent,
			htmlContent,
			flags: JSON.stringify(flags),
			receivedAt,
			syncedAt: new Date()
		})
		.onConflictDoUpdate({
			target: [mailMessage.mailbox, mailMessage.uid],
			set: {
				messageId: message.messageId ?? null,
				subject: message.subject?.trim() ?? '(no subject)',
				from: summarizeAddresses(message.from),
				to: summarizeAddresses(message.to),
				preview: createPreview(textContent),
				textContent,
				htmlContent,
				flags: JSON.stringify(flags),
				receivedAt,
				syncedAt: new Date()
			}
		});
}

async function runSync(config: MailConfig): Promise<SyncResult> {
	const state = await readSyncState(config.mailbox);
	const lastSyncedAt = state?.lastSyncedAt?.getTime() ?? 0;
	const pollMs = config.pollSeconds * 1000;

	if (lastSyncedAt && Date.now() - lastSyncedAt < pollMs) {
		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: true,
			fetchedCount: 0,
			storedCount: 0,
			lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
			lastError: state?.lastError ?? null,
			reason: 'Mailbox sync is still fresh.'
		};
	}

	const client = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: {
			user: config.user,
			pass: config.password
		}
	});

	let fetchedCount = 0;
	let storedCount = 0;
	let nextLastUid = state?.lastUid ?? 0;

	try {
		await client.connect();
		const lock = await client.getMailboxLock(config.mailbox);

		try {
			const mailbox = client.mailbox;
			const startUid =
				nextLastUid > 0
					? nextLastUid + 1
					: Math.max(((mailbox && mailbox.exists) || 1) - config.initialFetchCount + 1, 1);
			const range = `${startUid}:*`;

			for await (const item of client.fetch(range, {
				uid: true,
				source: true,
				flags: true,
				internalDate: true
			})) {
				if (!item.uid || !item.source) continue;

				const parsed = await simpleParser(item.source);
				const flags = Array.from(item.flags ?? []).map(String);

				const internalDate =
					item.internalDate instanceof Date
						? item.internalDate
						: typeof item.internalDate === 'string'
							? new Date(item.internalDate)
							: undefined;

				await storeMessage(config.mailbox, parsed, item.uid, flags, internalDate);
				fetchedCount += 1;
				storedCount += 1;
				nextLastUid = Math.max(nextLastUid, item.uid);
			}
		} finally {
			lock.release();
			await client.logout();
		}

		await saveSyncState(config.mailbox, {
			lastUid: nextLastUid,
			lastSyncedAt: new Date(),
			lastError: null
		});

		const refreshedState = await readSyncState(config.mailbox);

		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: false,
			fetchedCount,
			storedCount,
			lastSyncedAt: refreshedState?.lastSyncedAt?.toISOString() ?? null,
			lastError: null
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown IMAP sync error';

		await saveSyncState(config.mailbox, {
			lastUid: nextLastUid,
			lastSyncedAt: new Date(),
			lastError: message
		});

		const refreshedState = await readSyncState(config.mailbox);

		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: false,
			fetchedCount,
			storedCount,
			lastSyncedAt: refreshedState?.lastSyncedAt?.toISOString() ?? null,
			lastError: message,
			reason: 'Mailbox sync failed.'
		};
	}
}

export async function syncMailboxIfDue() {
	const config = getConfig();

	if ('missing' in config) {
		return {
			mailbox: config.mailbox,
			configured: false,
			skipped: true,
			fetchedCount: 0,
			storedCount: 0,
			lastSyncedAt: null,
			lastError: null,
			reason: `Missing ${config.missing.join(', ')}.`
		} satisfies SyncResult;
	}

	if (!activeSync) {
		activeSync = runSync(config).finally(() => {
			activeSync = null;
		});
	}

	return activeSync;
}

export async function listStoredMessages(limit = 100) {
	const config = getConfig();
	const mailbox = 'missing' in config ? config.mailbox : config.mailbox;

	return db
		.select()
		.from(mailMessage)
		.where(eq(mailMessage.mailbox, mailbox))
		.orderBy(desc(mailMessage.receivedAt), desc(mailMessage.uid))
		.limit(limit);
}
