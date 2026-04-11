import type { LayoutServerLoad } from './$types';
import { listImapMailboxes, startMailboxSync } from '$lib/server/mail';

export const load: LayoutServerLoad = async () => {
	void startMailboxSync();
	return { imapMailboxes: listImapMailboxes() };
};
