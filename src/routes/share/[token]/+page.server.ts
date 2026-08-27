import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getSharedMessagesByShareToken, markShareTokenAsRead } from '$lib/server/mail'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { inArray } from 'drizzle-orm'
import { isDemoModeEnabled, listDemoAttachmentsForMessages } from '$lib/server/demo'
import { getStoredPreferences } from '$lib/server/preferences'

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer' })
  const rawMessages = await getSharedMessagesByShareToken(params.token)

  if (!rawMessages || rawMessages.length === 0) {
    error(404, 'Shared message or thread not found or link is invalid')
  }

  await markShareTokenAsRead(params.token)
  const { sharePrivacyMode } = await getStoredPreferences()

  const messageIds = rawMessages.map((m) => m.messageId)

  const attachments = isDemoModeEnabled()
    ? listDemoAttachmentsForMessages(messageIds)
    : await db
        .select({
          id: mailAttachment.id,
          messageId: mailAttachment.messageId,
          filename: mailAttachment.filename,
          contentType: mailAttachment.contentType,
          size: mailAttachment.size
        })
        .from(mailAttachment)
        .where(inArray(mailAttachment.messageId, messageIds))

  const messages = rawMessages.map((msg) => ({
    messageId: msg.messageId,
    subject: msg.subject ?? 'No Subject',
    from: msg.from ?? 'Unknown Sender',
    to: msg.to ?? '',
    preview: msg.preview ?? '',
    textContent: msg.textContent ?? '',
    htmlContent: sharePrivacyMode === 'only-text' ? null : (msg.htmlContent ?? null),
    receivedAt: msg.receivedAt?.toISOString() ?? null
  }))

  const firstMessage = messages[0]
  const subject = firstMessage.subject

  return {
    token: params.token,
    subject,
    sharePrivacyMode,
    messages,
    attachments
  }
}
