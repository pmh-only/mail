import type { LayoutServerLoad } from './$types';
import { getMailboxSyncStatus, listStoredMessages, startMailboxSync } from '$lib/server/mail';

const PAGE_SIZE = 50;

function serializeMessage(message: Awaited<ReturnType<typeof listStoredMessages>>[number]) {
	return {
		id: message.id,
		uid: message.uid,
		subject: message.subject,
		from: message.from,
		to: message.to,
		preview: message.preview,
		textContent: message.textContent,
		flags: JSON.parse(message.flags) as string[],
		receivedAt: message.receivedAt?.toISOString() ?? null
	};
}

export const load: LayoutServerLoad = async () => {
	startMailboxSync();

	const [sync, rawMessages] = await Promise.all([
		getMailboxSyncStatus(),
		listStoredMessages(PAGE_SIZE + 1, 0)
	]);
	const hasMore = rawMessages.length > PAGE_SIZE;

	return {
		sync,
		messages: rawMessages.slice(0, PAGE_SIZE).map(serializeMessage),
		hasMore,
		pageSize: PAGE_SIZE
	};
};
