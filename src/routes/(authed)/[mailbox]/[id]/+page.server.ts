import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import {
  countSharedMessageReads,
  getStoredMessageById,
  getThreadMetadata,
  getMailboxRole,
  resolveMailboxScope
} from '$lib/server/mail'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { eq } from 'drizzle-orm'
import { isDemoModeEnabled, listDemoAttachmentsForMessage } from '$lib/server/demo'
import { getStoredPreferences } from '$lib/server/preferences'
import { countHtmlTracingCodes } from '$lib/tracing-detector'
import { serializeDate } from '$lib/serialize-date'

function serializeMessage(
  message: NonNullable<Awaited<ReturnType<typeof getStoredMessageById>>>,
  seen = false
) {
  const flags = JSON.parse(message.flags) as string[]
  const threadKey = message.threadKey || message.messageId

  return {
    id: message.id,
    threadKey,
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
    tracingCodeCount: countHtmlTracingCodes(message.htmlContent),
    inReplyTo: message.inReplyTo,
    references: message.references,
    spfStatus: message.spfStatus ?? null,
    dkimStatus: message.dkimStatus ?? null,
    dmarcStatus: message.dmarcStatus ?? null,
    authenticationTrusted: message.authenticationTrusted ?? false,
    openPgpSigned: message.openPgpSigned ?? false,
    openPgpSignatureStatus: message.openPgpSignatureStatus ?? null,
    openPgpSigner: message.openPgpSigner ?? null,
    openPgpFingerprint: message.openPgpFingerprint ?? null,
    openPgpEncrypted: message.openPgpEncrypted ?? false,
    openPgpDecrypted: message.openPgpDecrypted ?? false,
    openPgpError: message.openPgpError ?? null,
    rawSourceAvailable: message.rawSourceAvailable ?? isDemoModeEnabled(),
    sendStatus: message.sendStatus ?? null,
    smtpJobId: message.smtpJobId ?? null,
    openedAt: serializeDate(message.openedAt),
    flags: seen && !flags.includes('\\Seen') ? [...flags, '\\Seen'] : flags,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    snoozedUntil: message.snoozedUntil?.toISOString() ?? null
  }
}

export const load: PageServerLoad = async ({ params }) => {
  const startedAt = perfNow()
  if (!/^-?[1-9]\d*$/.test(params.id)) error(404, 'Message not found')
  const scope = await resolveMailboxScope(params.mailbox)
  const message = await getStoredMessageById(params.id)

  if (!message || (!scope.paths.includes(message.mailbox) && Number(params.id) > 0)) {
    error(404, 'Message not found')
  }
  const threadKey = message.threadKey || message.messageId

  // Load attachment metadata (no content blobs — served via /api/attachments/[id])
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
        .where(eq(mailAttachment.mailMessageId, message.contentId!))

  const [preferences, metadata] = await Promise.all([
    getStoredPreferences(),
    Promise.all(scope.paths.map((path) => getThreadMetadata(path, threadKey))).then((rows) => ({
      starred: rows.some((row) => row.starred),
      pinned: rows.some((row) => row.pinned)
    }))
  ])
  const shareReadCount = await countSharedMessageReads(message.messageId)
  const body = {
    message: serializeMessage(message),
    metadata,
    mailboxRole: getMailboxRole(message.mailbox),
    density: preferences.density,
    shareClickAction: preferences.shareClickAction,
    shareShiftClickAction: preferences.shareShiftClickAction,
    shareReadCount,
    attachments,
    remoteContent: preferences.remoteContent
  }

  perfLog('load.messagePage', {
    id: params.id,
    attachments: attachments.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
