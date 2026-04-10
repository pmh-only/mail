import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStoredMessageById, moveMessage, type MessageAction } from '$lib/server/mail';

const VALID_ACTIONS = new Set<MessageAction>(['archive', 'trash', 'spam']);

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const action = body?.action as string | undefined;

	if (!action || !VALID_ACTIONS.has(action as MessageAction)) {
		error(400, 'Invalid action');
	}

	const message = await getStoredMessageById(params.id);
	if (!message) error(404, 'Message not found');

	const targetMailbox = await moveMessage(message, action as MessageAction);
	if (!targetMailbox) error(422, 'Target mailbox not found');

	return json({ ok: true, targetMailbox });
};

function serializeMessage(message: NonNullable<Awaited<ReturnType<typeof getStoredMessageById>>>) {
	return {
		id: message.id,
		uid: message.uid,
		subject: message.subject,
		from: message.from,
		to: message.to,
		preview: message.preview,
		textContent: message.textContent,
		htmlContent: message.htmlContent,
		flags: JSON.parse(message.flags) as string[],
		receivedAt: message.receivedAt?.toISOString() ?? null
	};
}

export const GET: RequestHandler = async ({ params }) => {
	const message = await getStoredMessageById(params.id);

	if (!message) {
		error(404, 'Message not found');
	}

	return json({ message: serializeMessage(message) });
};
