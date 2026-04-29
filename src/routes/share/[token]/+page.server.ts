import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getMessageByShareToken } from '$lib/server/mail'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { isDemoModeEnabled, listDemoAttachmentsForMessage } from '$lib/server/demo'

export const load: PageServerLoad = async ({ params }) => {
  const message = await getMessageByShareToken(params.token)

  if (!message) {
    error(404, 'Shared message not found or link is invalid')
  }

  const attachments = isDemoModeEnabled()
    ? listDemoAttachmentsForMessage(message.messageId)
    : await db
        .select({
          id: mailAttachment.id,
          filename: mailAttachment.filename,
          contentType: mailAttachment.contentType,
          size: mailAttachment.size
        })
        .from(mailAttachment)
        .where(eq(mailAttachment.messageId, message.messageId))

  return {
    token: params.token,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: message.preview,
    textContent: message.textContent,
    htmlContent: message.htmlContent,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    attachments
  }
}
