import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ImapFlow } from 'imapflow';
import { getImapConfig } from '$lib/server/config';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));

	// Use submitted form values merged over saved/env config
	const saved = await getImapConfig();
	const imap = body.imap as Record<string, unknown> | undefined;

	const host = (imap?.host as string | undefined)?.trim() || ('host' in saved ? saved.host : '');
	const port =
		(typeof imap?.port === 'number' ? imap.port : null) ?? ('port' in saved ? saved.port : 993);
	const secure =
		(typeof imap?.secure === 'boolean' ? imap.secure : null) ??
		('secure' in saved ? saved.secure : true);
	const user = (imap?.user as string | undefined)?.trim() || ('user' in saved ? saved.user : '');
	// Accept new password if provided; fall back to saved (non-masked)
	const rawPassword = imap?.password as string | undefined;
	const password =
		rawPassword && rawPassword !== '••••••••'
			? rawPassword
			: 'password' in saved && !('missing' in saved)
				? saved.password
				: '';

	if (!host || !user || !password) {
		return json({ ok: false, message: 'Host, user, and password are required.' }, { status: 400 });
	}

	const client = new ImapFlow({
		host,
		port: Number(port),
		secure: Boolean(secure),
		auth: { user, pass: password },
		logger: false
	});

	try {
		await client.connect();
		await client.logout();
		return json({ ok: true, message: 'Connected successfully.' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ ok: false, message }, { status: 400 });
	}
};
