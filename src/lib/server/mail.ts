import { env } from '$env/dynamic/private';
import { and, desc, eq } from 'drizzle-orm';
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
};

export type MailRow = typeof mailMessage.$inferSelect;

export type SyncResult = {
	mailbox: string;
	configured: boolean;
	skipped: boolean;
	syncing?: boolean;
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
		pollSeconds: parseNumber(env.IMAP_POLL_SECONDS, 15)
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

function dedupe(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}

function extractErrorParts(error: unknown, seen = new Set<unknown>()): string[] {
	if (!error || seen.has(error)) return [];
	seen.add(error);

	if (typeof error === 'string') {
		return error.trim() ? [error.trim()] : [];
	}

	if (!(error instanceof Error) && typeof error !== 'object') {
		return [];
	}

	const record = error as Record<string, unknown>;
	const parts: string[] = [];

	if (error instanceof Error && error.message.trim()) {
		parts.push(error.message.trim());
	}

	for (const key of ['responseText', 'response', 'serverResponse', 'stderr', 'stdout']) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) {
			parts.push(value.trim());
		}
	}

	if (typeof record.command === 'string' && record.command.trim()) {
		parts.push(`Command: ${record.command.trim()}`);
	}

	if (typeof record.code === 'string' && record.code.trim()) {
		parts.push(`Code: ${record.code.trim()}`);
	}

	if ('cause' in record) {
		parts.push(...extractErrorParts(record.cause, seen));
	}

	return dedupe(parts);
}

function getErrorMessage(error: unknown) {
	const parts = extractErrorParts(error);
	const meaningfulParts =
		parts.length > 1 ? parts.filter((part) => !/^Command failed\b/i.test(part)) : parts;

	return meaningfulParts[0] ?? parts[0] ?? 'Unknown IMAP sync error';
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
	const previousFetchedCount = state?.lastFetchedCount ?? 0;
	const previousStoredCount = state?.lastStoredCount ?? 0;
	const historyComplete = state?.historyComplete ?? false;

	if (lastSyncedAt && Date.now() - lastSyncedAt < pollMs) {
		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: true,
			fetchedCount: previousFetchedCount,
			storedCount: previousStoredCount,
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
			const needsInitialBackfill = !historyComplete && nextLastUid === 0;
			const range = needsInitialBackfill ? '1:*' : `${nextLastUid + 1}:*`;
			const fetchOptions = needsInitialBackfill ? undefined : { uid: true };

			for await (const item of client.fetch(
				range,
				{
					uid: true,
					source: true,
					flags: true,
					internalDate: true
				},
				fetchOptions
			)) {
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
			historyComplete: true,
			lastFetchedCount: fetchedCount,
			lastStoredCount: storedCount,
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
		const message = getErrorMessage(error);
		const effectiveFetchedCount = fetchedCount || previousFetchedCount;
		const effectiveStoredCount = storedCount || previousStoredCount;

		await saveSyncState(config.mailbox, {
			lastUid: nextLastUid,
			historyComplete,
			lastFetchedCount: effectiveFetchedCount,
			lastStoredCount: effectiveStoredCount,
			lastSyncedAt: new Date(),
			lastError: message
		});

		const refreshedState = await readSyncState(config.mailbox);

		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: false,
			fetchedCount: effectiveFetchedCount,
			storedCount: effectiveStoredCount,
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

export function startMailboxSync() {
	void syncMailboxIfDue().catch(() => {
		// Sync failures are persisted to mailbox_sync and surfaced via getMailboxSyncStatus.
	});
}

export async function getMailboxSyncStatus(): Promise<SyncResult> {
	const config = getConfig();

	if ('missing' in config) {
		return {
			mailbox: config.mailbox,
			configured: false,
			skipped: true,
			syncing: false,
			fetchedCount: 0,
			storedCount: 0,
			lastSyncedAt: null,
			lastError: null,
			reason: `Missing ${config.missing.join(', ')}.`
		};
	}

	const state = await readSyncState(config.mailbox);

	if (!state) {
		return {
			mailbox: config.mailbox,
			configured: true,
			skipped: true,
			syncing: activeSync !== null,
			fetchedCount: 0,
			storedCount: 0,
			lastSyncedAt: null,
			lastError: null,
			reason: activeSync ? 'Background sync in progress.' : 'Waiting for first sync.'
		};
	}

	const pollMs = config.pollSeconds * 1000;
	const lastSyncedAt = state.lastSyncedAt?.getTime() ?? 0;
	const skipped = !!lastSyncedAt && Date.now() - lastSyncedAt < pollMs;

	return {
		mailbox: config.mailbox,
		configured: true,
		skipped,
		syncing: activeSync !== null,
		fetchedCount: state.lastFetchedCount,
		storedCount: state.lastStoredCount,
		lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
		lastError: state.lastError ?? null,
		reason: activeSync
			? 'Background sync in progress.'
			: skipped
				? 'Mailbox sync is still fresh.'
				: state.lastError
					? 'Mailbox sync failed.'
					: undefined
	};
}

export async function listStoredMessages(limit = 100, offset = 0) {
	const config = getConfig();
	const mailbox = 'missing' in config ? config.mailbox : config.mailbox;

	return db
		.select()
		.from(mailMessage)
		.where(eq(mailMessage.mailbox, mailbox))
		.orderBy(desc(mailMessage.receivedAt), desc(mailMessage.uid))
		.offset(offset)
		.limit(limit);
}

export async function getStoredMessageById(id: string) {
	const config = getConfig();
	const mailbox = 'missing' in config ? config.mailbox : config.mailbox;

	const [message] = await db
		.select()
		.from(mailMessage)
		.where(and(eq(mailMessage.mailbox, mailbox), eq(mailMessage.id, id)))
		.limit(1);

	return message ?? null;
}
