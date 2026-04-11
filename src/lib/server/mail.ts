import { desc, eq, inArray } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from '$lib/server/db';
import { mailboxSync, mailMessage, mailMessageMailbox } from '$lib/server/db/schema';
import { enqueueMarkRead, enqueueMoveMessage, registerImapConfig } from '$lib/server/imap-queue';
import { getImapConfig, type ImapConfig } from '$lib/server/config';

// Joined row returned by list/get queries
export type MailRow = {
	id: number; // mail_message_mailbox.id
	messageId: string;
	mailbox: string;
	uid: number;
	flags: string;
	subject: string;
	from: string;
	to: string;
	preview: string;
	textContent: string;
	htmlContent: string | null;
	receivedAt: Date | null;
};

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

registerImapConfig(async () => {
	const config = await getImapConfig();
	if ('missing' in config) return null;
	return {
		host: config.host,
		port: config.port,
		secure: config.secure,
		user: config.user,
		password: config.password
	};
});

function summarizeAddresses(input: unknown) {
	if (!input || typeof input !== 'object' || !('value' in input)) return '';
	const addresses = (input as { value?: Array<{ name?: string; address?: string }> }).value ?? [];
	return addresses
		.map((entry) => entry.name || entry.address || '')
		.filter(Boolean)
		.join(', ');
}

function createPreview(text: string) {
	return text
		.replace(/!\[.*?\]\(.*?\)/g, '') // images with src
		.replace(/\[.*?\]\(.*?\)/g, '') // links
		.replace(/\[https?:\/\/[^\]]*\]/g, '') // bare [url] blocks
		.replace(/\[image:[^\]]*\]/gi, '') // [image: ...] alt text
		.replace(/`{1,3}[^`]*`{1,3}/g, '') // code
		.replace(/^#{1,6}\s+/gm, '') // headings
		.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2') // bold/italic
		.replace(/~~(.*?)~~/g, '$1') // strikethrough
		.replace(/^\s*[-*+>]\s+/gm, '') // list items, blockquotes
		.replace(/^\s*[-_*]{3,}\s*$/gm, '') // horizontal rules
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 240);
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

// Store or skip message content (skipped if message_id already exists)
async function storeMessageContent(
	effectiveMessageId: string,
	message: Awaited<ReturnType<typeof simpleParser>>,
	internalDate?: Date
) {
	const receivedAt = message.date ?? internalDate ?? null;
	const textContent = message.text?.trim() ?? '';
	const htmlContent = typeof message.html === 'string' ? message.html : null;

	await db
		.insert(mailMessage)
		.values({
			messageId: effectiveMessageId,
			subject: message.subject?.trim() ?? '(no subject)',
			from: summarizeAddresses(message.from),
			to: summarizeAddresses(message.to),
			preview: createPreview(textContent),
			textContent,
			htmlContent,
			receivedAt
		})
		.onConflictDoNothing();
}

// Insert or update the per-mailbox entry for a message
async function storeMailboxEntry(
	effectiveMessageId: string,
	mailbox: string,
	uid: number,
	flags: string[]
) {
	await db
		.insert(mailMessageMailbox)
		.values({
			messageId: effectiveMessageId,
			mailbox,
			uid,
			flags: JSON.stringify(flags),
			syncedAt: new Date()
		})
		.onConflictDoUpdate({
			target: [mailMessageMailbox.mailbox, mailMessageMailbox.uid],
			set: {
				messageId: effectiveMessageId,
				flags: JSON.stringify(flags),
				syncedAt: new Date()
			}
		});
}

async function syncOneMailbox(
	config: ImapConfig,
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

	console.log(`[sync] ${mailboxPath}: starting`);
	try {
		await client.connect();
		const lock = await client.getMailboxLock(mailboxPath);
		try {
			const needsInitialBackfill = !historyComplete && nextLastUid === 0;
			const range = needsInitialBackfill ? '1:*' : `${nextLastUid + 1}:*`;
			const fetchOptions = needsInitialBackfill ? undefined : { uid: true };

			// Phase 1: fetch lightweight envelopes to discover message-ids
			type EnvelopeItem = {
				uid: number;
				effectiveMessageId: string;
				flags: string[];
				internalDate: Date | undefined;
			};
			const envelopeItems: EnvelopeItem[] = [];

			for await (const item of client.fetch(
				range,
				{ uid: true, envelope: true, flags: true, internalDate: true },
				fetchOptions
			)) {
				if (!item.uid) continue;
				const msgId = (item.envelope as { messageId?: string } | undefined)?.messageId?.trim();
				const effectiveMessageId = msgId || `synthetic:${mailboxPath}:${item.uid}`;
				const flags = Array.from(item.flags ?? []).map(String);
				const internalDate =
					item.internalDate instanceof Date
						? item.internalDate
						: typeof item.internalDate === 'string'
							? new Date(item.internalDate)
							: undefined;

				envelopeItems.push({ uid: item.uid, effectiveMessageId, flags, internalDate });
				nextLastUid = Math.max(nextLastUid, item.uid);
				fetchedCount += 1;
			}

			if (envelopeItems.length === 0) {
				console.log(`[sync] ${mailboxPath}: no new messages`);
			} else {
				// Phase 2: check which message-ids we already have content for
				const allMessageIds = envelopeItems.map((i) => i.effectiveMessageId);
				const existingIds = new Set(
					(
						await db
							.select({ messageId: mailMessage.messageId })
							.from(mailMessage)
							.where(inArray(mailMessage.messageId, allMessageIds))
					).map((r) => r.messageId)
				);

				// Phase 3: fetch full source only for messages we don't have yet
				const needsSourceUids = envelopeItems
					.filter((i) => !existingIds.has(i.effectiveMessageId))
					.map((i) => i.uid);

				const sourceByUid = new Map<number, Awaited<ReturnType<typeof simpleParser>>>();
				if (needsSourceUids.length > 0) {
					console.log(
						`[sync] ${mailboxPath}: fetching source for ${needsSourceUids.length}/${fetchedCount} messages (${fetchedCount - needsSourceUids.length} already cached)`
					);
					for await (const item of client.fetch(
						needsSourceUids.join(','),
						{ uid: true, source: true },
						{ uid: true }
					)) {
						if (!item.uid || !item.source) continue;
						sourceByUid.set(item.uid, await simpleParser(item.source));
					}
				} else {
					console.log(
						`[sync] ${mailboxPath}: all ${fetchedCount} messages already cached, updating mailbox entries only`
					);
				}

				// Store content + mailbox entries
				for (const item of envelopeItems) {
					const parsed = sourceByUid.get(item.uid);
					if (parsed) {
						await storeMessageContent(item.effectiveMessageId, parsed, item.internalDate);
					}
					await storeMailboxEntry(item.effectiveMessageId, mailboxPath, item.uid, item.flags);
					storedCount += 1;
					if (storedCount % 10 === 0) {
						console.log(`[sync] ${mailboxPath}: stored ${storedCount}/${fetchedCount}...`);
					}
				}
			}
		} finally {
			lock.release();
		}

		console.log(`[sync] ${mailboxPath}: done — ${fetchedCount} fetched, ${storedCount} stored`);
		await saveSyncState(mailboxPath, {
			lastUid: nextLastUid,
			historyComplete: true,
			lastFetchedCount: fetchedCount,
			lastStoredCount: storedCount,
			lastSyncedAt: new Date(),
			lastError: null
		});
	} catch (error) {
		console.error(`[sync] ${mailboxPath}: error — ${getErrorMessage(error)}`);
		await saveSyncState(mailboxPath, {
			lastUid: nextLastUid,
			historyComplete,
			lastFetchedCount: fetchedCount || (state?.lastFetchedCount ?? 0),
			lastStoredCount: storedCount || (state?.lastStoredCount ?? 0),
			lastSyncedAt: new Date(),
			lastError: getErrorMessage(error)
		});
	} finally {
		try {
			await client.logout();
		} catch {
			/* ignore */
		}
	}
}

async function runSyncAll(config: ImapConfig): Promise<void> {
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
		try {
			await listClient.logout();
		} catch {
			/* ignore */
		}
	}

	// Sync mailboxes sequentially — many IMAP servers reject multiple simultaneous connections
	// Skip \Noselect folders (container-only folders that can't be opened)
	for (const mb of listed) {
		if (mb.flags?.has('\\Noselect')) continue;
		await syncOneMailbox(config, mb.path, pollMs);
	}
}

export async function startMailboxSync() {
	startMailboxCacheRefresh();

	const config = await getImapConfig();
	if ('missing' in config) return;

	if (!activeSync) {
		activeSync = runSyncAll(config).finally(() => {
			activeSync = null;
		});
	}
}

export async function getSyncSummary(): Promise<{
	syncing: boolean;
	configured: boolean;
	hasError: boolean;
	lastSyncedAt: string | null;
	errorMessage: string | null;
}> {
	const config = await getImapConfig();
	if ('missing' in config) {
		return {
			syncing: false,
			configured: false,
			hasError: false,
			lastSyncedAt: null,
			errorMessage: null
		};
	}

	const rows = await db.select().from(mailboxSync);

	// Only consider rows that have actually been synced (have a lastSyncedAt)
	const syncedRows = rows.filter((r) => r.lastSyncedAt !== null);
	const errorRows = syncedRows.filter((r) => r.lastError);
	const okRows = syncedRows.filter((r) => !r.lastError);

	// Report an error only when no mailbox synced successfully, or inbox specifically failed
	const hasError =
		errorRows.length > 0 &&
		(okRows.length === 0 || errorRows.some((r) => /inbox/i.test(r.mailbox)));

	const errorMessage = errorRows[0]?.lastError ?? null;
	const latest = syncedRows.reduce<Date | null>((max, r) => {
		if (!r.lastSyncedAt) return max;
		return !max || r.lastSyncedAt > max ? r.lastSyncedAt : max;
	}, null);

	return {
		syncing: activeSync !== null,
		configured: true,
		hasError,
		lastSyncedAt: latest?.toISOString() ?? null,
		errorMessage
	};
}

export async function getMailboxSyncStatus(mailboxPath: string): Promise<SyncResult> {
	const config = await getImapConfig();

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
	const config = await getImapConfig();
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
	mailboxRefreshTimer = setInterval(() => {
		void refreshMailboxCache();
	}, MAILBOX_REFRESH_MS);
}

export function listImapMailboxes(): ImapMailbox[] {
	return cachedMailboxes ?? [];
}

const joinedSelect = {
	id: mailMessageMailbox.id,
	messageId: mailMessage.messageId,
	mailbox: mailMessageMailbox.mailbox,
	uid: mailMessageMailbox.uid,
	flags: mailMessageMailbox.flags,
	subject: mailMessage.subject,
	from: mailMessage.from,
	to: mailMessage.to,
	preview: mailMessage.preview,
	textContent: mailMessage.textContent,
	htmlContent: mailMessage.htmlContent,
	receivedAt: mailMessage.receivedAt
};

export async function listStoredMessages(mailboxPath: string, limit = 100, offset = 0) {
	return db
		.select(joinedSelect)
		.from(mailMessageMailbox)
		.innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
		.where(eq(mailMessageMailbox.mailbox, mailboxPath))
		.orderBy(desc(mailMessage.receivedAt), desc(mailMessageMailbox.uid))
		.offset(offset)
		.limit(limit);
}

export async function getStoredMessageById(id: string | number): Promise<MailRow | null> {
	const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
	const [message] = await db
		.select(joinedSelect)
		.from(mailMessageMailbox)
		.innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
		.where(eq(mailMessageMailbox.id, numericId))
		.limit(1);

	return message ?? null;
}

export async function markMessageAsRead(message: MailRow) {
	const config = await getImapConfig();
	if ('missing' in config) return;

	const flags: string[] = JSON.parse(message.flags);
	if (flags.includes('\\Seen')) return;

	await db
		.update(mailMessageMailbox)
		.set({ flags: JSON.stringify([...flags, '\\Seen']) })
		.where(eq(mailMessageMailbox.id, message.id));

	enqueueMarkRead(message.uid, message.mailbox);
}

export type MessageAction = 'archive' | 'trash' | 'spam' | 'inbox';

const ROLE_PATTERNS: Record<MessageAction, RegExp> = {
	inbox: /\binbox\b/i,
	archive: /\b(archive|all[\s._-]?mail)\b/i,
	trash: /\b(trash|deleted[\s._-]?(items|messages)?)\b/i,
	spam: /\b(spam|junk([\s._-]?email)?)\b/i
};

export function getMailboxRole(mailboxPath: string): MessageAction | null {
	for (const [role, pattern] of Object.entries(ROLE_PATTERNS) as [MessageAction, RegExp][]) {
		if (pattern.test(mailboxPath)) return role;
	}
	return null;
}

export function findMailboxForAction(action: MessageAction): string | null {
	const mailboxes = cachedMailboxes ?? [];
	const pattern = ROLE_PATTERNS[action];
	return mailboxes.find((mb) => pattern.test(mb.path) || pattern.test(mb.name))?.path ?? null;
}

export async function moveMessage(message: MailRow, action: MessageAction): Promise<string | null> {
	const targetMailbox = findMailboxForAction(action);
	if (!targetMailbox || targetMailbox === message.mailbox) return null;

	// Optimistically remove from source mailbox — next sync will add it to target
	await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, message.id));

	enqueueMoveMessage(message.uid, message.mailbox, targetMailbox);
	return targetMailbox;
}
