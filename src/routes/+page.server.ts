import type { PageServerLoad } from './$types';
import { listStoredMessages, syncMailboxIfDue } from '$lib/server/mail';

export const load: PageServerLoad = async () => {
	const sync = await syncMailboxIfDue();
	const messages = await listStoredMessages(100);

	return {
		sync,
		messages: messages.map((message) => ({
			id: message.id,
			uid: message.uid,
			subject: message.subject,
			from: message.from,
			to: message.to,
			preview: message.preview,
			textContent: message.textContent,
			flags: JSON.parse(message.flags) as string[],
			receivedAt: message.receivedAt?.toISOString() ?? null
		}))
	};
};
