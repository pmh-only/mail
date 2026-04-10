import { env } from '$env/dynamic/private';
import { desc, eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from '$lib/server/db';
import { mailboxSync, mailMessage } from '$lib/server/db/schema';
import { enqueueMarkRead, enqueueMoveMessage, registerImapConfig } from '$lib/server/imap-queue';

type MailConfig = {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
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

let activeSync: Promise<void> | null = null;

registerImapConfig(() => {
	const config = getConfig();
	if ('missing' in config) return null;
	return { host: config.host, port: config.port, secure: config.secure, user: config.user, password: config.password };
});

function parseBoolean(value: string | undefined, fallback: boolean) {
	if (value == null || value === '') return fallback;
	return value.toLowerCase() !== 'false';
}

function parseNumber(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(): MailConfig | { missing: string[] } {
	const required = {
		IMAP_HOST: env.IMAP_HOST,
		IMAP_USER: env.IMAP_USER,
		IMAP_PASSWORD: env.IMAP_PASSWORD
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);

	if (missing.length > 0) {
		return { missing };
	}

	return {
		host: env.IMAP_HOST!,
		port: parseNumber(env.IMAP_PORT, 993),
		secure: parseBoolean(env.IMAP_SECURE, true),
		user: env.IMAP_USER!,
		password: env.IMAP_PASSWORD!,
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

async function syncOneMailbox(
	config: MailConfig,
	mailboxPath: string,
	pollMs: number
): Promise<void> {
	const state = await readSyncState(mailboxPath);
	const lastSyncedAt = state?.lastSyncedAt?.getTime() ?? 0;

	if (lastSyncedAt && Date.now() - lastSyncedAt < pollMs) return;

	const client = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: config.user, pass: config.password },
		logger: false
	});

	const historyComplete = state?.historyComplete ?? false;
	let nextLastUid = state?.lastUid ?? 0;
	let fetchedCount = 0;
	let storedCount = 0;

	try {
		await client.connect();
		const lock = await client.getMailboxLock(mailboxPath);
		try {
			const needsInitialBackfill = !historyComplete && nextLastUid === 0;
			const range = needsInitialBackfill ? '1:*' : `${nextLastUid + 1}:*`;
			const fetchOptions = needsInitialBackfill ? undefined : { uid: true };

			for await (const item of client.fetch(
				range,
				{ uid: true, source: true, flags: true, internalDate: true },
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

				await storeMessage(mailboxPath, parsed, item.uid, flags, internalDate);
				fetchedCount += 1;
				storedCount += 1;
				nextLastUid = Math.max(nextLastUid, item.uid);
			}
		} finally {
			lock.release();
		}

		await saveSyncState(mailboxPath, {
			lastUid: nextLastUid,
			historyComplete: true,
			lastFetchedCount: fetchedCount,
			lastStoredCount: storedCount,
			lastSyncedAt: new Date(),
			lastError: null
		});
	} catch (error) {
		await saveSyncState(mailboxPath, {
			lastUid: nextLastUid,
			historyComplete,
			lastFetchedCount: fetchedCount || (state?.lastFetchedCount ?? 0),
			lastStoredCount: storedCount || (state?.lastStoredCount ?? 0),
			lastSyncedAt: new Date(),
			lastError: getErrorMessage(error)
		});
	} finally {
		try { await client.logout(); } catch { /* ignore */ }
	}
}

async function runSyncAll(config: MailConfig): Promise<void> {
	// Use a single connection just to list mailboxes
	const listClient = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: config.user, pass: config.password },
		logger: false
	});

	const pollMs = config.pollSeconds * 1000;
	let listed: Awaited<ReturnType<typeof listClient.list>>;

	try {
		await listClient.connect();
		listed = await listClient.list();
		cachedMailboxes = listed.map((mb) => ({
			path: mb.path,
			name: mb.name,
			delimiter: mb.delimiter ?? '/'
		}));
	} finally {
		try { await listClient.logout(); } catch { /* ignore */ }
	}

	// Sync all mailboxes in parallel, each with its own connection
	await Promise.all(listed.map((mb) => syncOneMailbox(config, mb.path, pollMs)));
}

export function startMailboxSync() {
	startMailboxCacheRefresh();

	const config = getConfig();
	if ('missing' in config) return;

	if (!activeSync) {
		activeSync = runSyncAll(config).finally(() => {
			activeSync = null;
		});
	}
}

export async function getMailboxSyncStatus(mailboxPath: string): Promise<SyncResult> {
	const config = getConfig();

	if ('missing' in config) {
		return {
			mailbox: mailboxPath,
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

	const state = await readSyncState(mailboxPath);

	if (!state) {
		return {
			mailbox: mailboxPath,
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
		mailbox: mailboxPath,
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

export type ImapMailbox = {
	path: string;
	name: string;
	delimiter: string;
};

let cachedMailboxes: ImapMailbox[] | null = null;
const MAILBOX_REFRESH_MS = 10 * 60 * 1000;
let mailboxRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function refreshMailboxCache(): Promise<void> {
	const config = getConfig();
	if ('missing' in config) return;

	const client = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: config.user, pass: config.password },
		logger: false
	});

	try {
		await client.connect();
		const tree = await client.list();
		await client.logout();

		cachedMailboxes = tree.map((mb) => ({
			path: mb.path,
			name: mb.name,
			delimiter: mb.delimiter ?? '/'
		}));
	} catch {
		// keep existing cache on failure
	}
}

function startMailboxCacheRefresh() {
	if (mailboxRefreshTimer) return;
	void refreshMailboxCache();
	mailboxRefreshTimer = setInterval(() => { void refreshMailboxCache(); }, MAILBOX_REFRESH_MS);
}

export function listImapMailboxes(): ImapMailbox[] {
	return cachedMailboxes ?? [];
}

export async function listStoredMessages(mailboxPath: string, limit = 100, offset = 0) {
	return db
		.select()
		.from(mailMessage)
		.where(eq(mailMessage.mailbox, mailboxPath))
		.orderBy(desc(mailMessage.receivedAt), desc(mailMessage.uid))
		.offset(offset)
		.limit(limit);
}

export async function getStoredMessageById(id: string) {
	const [message] = await db
		.select()
		.from(mailMessage)
		.where(eq(mailMessage.id, id))
		.limit(1);

	return message ?? null;
}

export async function markMessageAsRead(message: MailRow) {
	const config = getConfig();
	if ('missing' in config) return;

	const flags: string[] = JSON.parse(message.flags);
	if (flags.includes('\\Seen')) return;

	await db
		.update(mailMessage)
		.set({ flags: JSON.stringify([...flags, '\\Seen']) })
		.where(eq(mailMessage.id, message.id));

	enqueueMarkRead(message.uid, message.mailbox);
}

export type MessageAction = 'archive' | 'trash' | 'spam';

const ROLE_PATTERNS: Record<MessageAction, RegExp> = {
	archive: /\b(archive|all[\s._-]?mail)\b/i,
	trash: /\b(trash|deleted[\s._-]?(items|messages)?)\b/i,
	spam: /\b(spam|junk([\s._-]?email)?)\b/i
};

export function findMailboxForAction(action: MessageAction): string | null {
	const mailboxes = cachedMailboxes ?? [];
	const pattern = ROLE_PATTERNS[action];
	return mailboxes.find((mb) => pattern.test(mb.path) || pattern.test(mb.name))?.path ?? null;
}

export async function moveMessage(message: MailRow, action: MessageAction): Promise<string | null> {
	const targetMailbox = findMailboxForAction(action);
	if (!targetMailbox || targetMailbox === message.mailbox) return null;

	// Optimistically update DB: move message to target mailbox
	await db
		.update(mailMessage)
		.set({ mailbox: targetMailbox })
		.where(eq(mailMessage.id, message.id));

	enqueueMoveMessage(message.uid, message.mailbox, targetMailbox);
	return targetMailbox;
}
