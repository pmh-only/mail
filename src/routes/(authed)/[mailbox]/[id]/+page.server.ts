import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getStoredMessageById, markMessageAsRead, getMailboxRole } from '$lib/server/mail'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'

function serializeMessage(message: NonNullable<Awaited<ReturnType<typeof getStoredMessageById>>>) {
  return {
    id: message.id,
    uid: message.uid,
    messageId: message.messageId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: message.preview,
    textContent: message.textContent,
    htmlContent: message.htmlContent,
    flags: JSON.parse(message.flags) as string[],
    receivedAt: message.receivedAt?.toISOString() ?? null
  }
}

export const load: PageServerLoad = async ({ params }) => {
  const message = await getStoredMessageById(params.id)

  if (!message) {
    error(404, 'Message not found')
  }

  void markMessageAsRead(message)

  // Load attachment metadata (no content blobs — served via /api/attachments/[id])
  const attachments = await db
    .select({
      id: mailAttachment.id,
      filename: mailAttachment.filename,
      contentType: mailAttachment.contentType,
      size: mailAttachment.size
    })
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, message.messageId))

  return {
    message: serializeMessage(message),
    mailboxRole: getMailboxRole(message.mailbox),
    attachments
  }
}
