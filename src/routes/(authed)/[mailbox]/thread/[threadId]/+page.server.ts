import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import {
  getMessagesInMailboxesThread,
  getThreadMetadata,
  markMessagesSeen,
  getMailboxRole,
  resolveMailboxScope
} from '$lib/server/mail'
import { decodeThreadId } from '$lib/thread-url'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { inArray } from 'drizzle-orm'
import {
  isDemoModeEnabled,
  listDemoAttachmentsForMessages,
  markDemoMessagesSeen
} from '$lib/server/demo'
import { getStoredPreferences } from '$lib/server/preferences'
import { getThreadNote, serializeThreadNote } from '$lib/server/thread-notes'
import { unreadMessageRows } from '$lib/read-state'
import { serializeDate } from '$lib/serialize-date'

function serializeMessage(
  message: Awaited<ReturnType<typeof getMessagesInMailboxesThread>>[number]
) {
  const flags = JSON.parse(message.flags) as string[]

  return {
    id: message.id,
    uid: message.uid,
    messageId: message.messageId,
    mailbox: message.mailbox,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    preview: message.preview,
    textContent: message.textContent,
    htmlContent: message.htmlContent,
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
    flags,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    snoozedUntil: message.snoozedUntil?.toISOString() ?? null,
    threadDepth: message.threadDepth ?? 0
  }
}

export const load: PageServerLoad = async ({ params }) => {
  const startedAt = perfNow()
  const threadId = decodeThreadId(params.threadId)
  const scope = await resolveMailboxScope(params.mailbox)
  const messages = await getMessagesInMailboxesThread(threadId, scope.paths)

  if (messages.length === 0) {
    error(404, 'Thread not found')
  }

  if (messages.length === 1) {
    redirect(302, `/${params.mailbox}/${messages[0].id}`)
  }

  const messageIds = messages.map((m) => m.messageId)
  const contentIds = messages.flatMap((message) =>
    typeof message.contentId === 'number' ? [message.contentId] : []
  )

  // Load attachment metadata for all messages in the thread
  const attachments =
    messageIds.length > 0
      ? isDemoModeEnabled()
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
            .where(inArray(mailAttachment.mailMessageId, contentIds))
      : []

  const [mailboxRole, metadata, threadNote] = await Promise.all([
    Promise.resolve(scope.composedMailbox ? null : getMailboxRole(scope.path)),
    Promise.all(scope.paths.map((path) => getThreadMetadata(path, threadId))).then((rows) => ({
      starred: rows.some((row) => row.starred),
      pinned: rows.some((row) => row.pinned)
    })),
    getThreadNote(threadId)
  ])

  const preferences = await getStoredPreferences()
  const body = {
    threadId,
    mailbox: scope.path,
    mailboxPaths: scope.paths,
    composedMailbox: scope.composedMailbox,
    messages: messages.map(serializeMessage),
    attachments,
    mailboxRole,
    remoteContent: preferences.remoteContent,
    threadNote: serializeThreadNote(threadNote),
    metadata
  }

  perfLog('load.threadPage', {
    mailbox: scope.path,
    threadId,
    messages: body.messages.length,
    attachments: attachments.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
