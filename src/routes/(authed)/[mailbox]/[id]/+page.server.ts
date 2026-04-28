import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getStoredMessageById, markMessageAsRead, getMailboxRole } from '$lib/server/mail'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { eq } from 'drizzle-orm'

function serializeMessage(message: NonNullable<Awaited<ReturnType<typeof getStoredMessageById>>>) {
  return {
    id: message.id,
    uid: message.uid,
    messageId: message.messageId,
    mailbox: message.mailbox,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    replyTo: message.replyTo,
    preview: message.preview,
    textContent: message.textContent,
    htmlContent: message.htmlContent,
    inReplyTo: message.inReplyTo,
    references: message.references,
    flags: JSON.parse(message.flags) as string[],
    receivedAt: message.receivedAt?.toISOString() ?? null
  }
}

export const load: PageServerLoad = async ({ params }) => {
  const startedAt = perfNow()
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

  const body = {
    message: serializeMessage(message),
    mailboxRole: getMailboxRole(message.mailbox),
    attachments
  }

  perfLog('load.messagePage', {
    id: params.id,
    attachments: attachments.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
