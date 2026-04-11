import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import nodemailer from 'nodemailer';
import { getSmtpConfig } from '$lib/server/config';

export const POST: RequestHandler = async ({ request }) => {
	const smtpConfig = await getSmtpConfig();
	if ('missing' in smtpConfig) {
		return error(500, `Missing SMTP config: ${smtpConfig.missing.join(', ')}`);
	}

	const { to, cc, bcc, subject, html, inReplyTo } = await request.json();
	if (!to || !subject) {
		return error(400, 'Missing required fields: to, subject');
	}

	const transporter = nodemailer.createTransport({
		host: smtpConfig.host,
		port: smtpConfig.port,
		secure: smtpConfig.secure,
		auth: {
			user: smtpConfig.user,
			pass: smtpConfig.password
		}
	});

	try {
		await transporter.sendMail({
			from: smtpConfig.from,
			to,
			cc: cc || undefined,
			bcc: bcc || undefined,
			subject,
			html,
			inReplyTo: inReplyTo || undefined
		});
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return error(500, `Failed to send: ${message}`);
	}
};
