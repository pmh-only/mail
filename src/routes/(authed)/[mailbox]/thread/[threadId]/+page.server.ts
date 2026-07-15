import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import {
  getMessagesInThread,
  getThreadMetadata,
  markMessageAsRead,
  getMailboxRole,
  resolveMailboxPath
} from '$lib/server/mail'
import { decodeThreadId } from '$lib/thread-url'
import { db } from '$lib/server/db'
import { mailAttachment } from '$lib/server/db/schema'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { inArray } from 'drizzle-orm'
import { isDemoModeEnabled, listDemoAttachmentsForMessages } from '$lib/server/demo'
import {
  getBlockRemoteContentEnabled,
  getRemoteContentAllowedSenders
} from '$lib/server/preferences'
import { getThreadNote, serializeThreadNote } from '$lib/server/thread-notes'

function serializeMessage(message: Awaited<ReturnType<typeof getMessagesInThread>>[number]) {
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
    flags,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    snoozedUntil: message.snoozedUntil?.toISOString() ?? null,
    threadDepth: message.threadDepth ?? 0
  }
}

export const load: PageServerLoad = async ({ params, cookies }) => {
  const startedAt = perfNow()
  const threadId = decodeThreadId(params.threadId)
  const mailboxPath = await resolveMailboxPath(params.mailbox)
  const messages = await getMessagesInThread(threadId, mailboxPath)

  if (messages.length === 0) {
    error(404, 'Thread not found')
  }

  if (messages.length === 1) {
    redirect(302, `/${params.mailbox}/${messages[0].id}`)
  }

  const latestMessage = messages.reduce((latest, message) =>
    (message.receivedAt?.getTime() ?? 0) > (latest.receivedAt?.getTime() ?? 0) ? message : latest
  )
  await markMessageAsRead(latestMessage)
  const latestFlags = JSON.parse(latestMessage.flags) as string[]
  if (!latestFlags.includes('\\Seen')) {
    latestMessage.flags = JSON.stringify([...latestFlags, '\\Seen'])
  }

  const messageIds = messages.map((m) => m.messageId)

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
            .where(inArray(mailAttachment.messageId, messageIds))
      : []

  const [mailboxRole, metadata, threadNote] = await Promise.all([
    Promise.resolve(getMailboxRole(mailboxPath)),
    getThreadMetadata(mailboxPath, threadId),
    getThreadNote(threadId)
  ])

  const body = {
    threadId,
    mailbox: mailboxPath,
    messages: messages.map(serializeMessage),
    attachments,
    mailboxRole,
    remoteContent: {
      blockRemoteContent: getBlockRemoteContentEnabled(cookies),
      allowedSenders: getRemoteContentAllowedSenders(cookies)
    },
    threadNote: serializeThreadNote(threadNote),
    metadata
  }

  perfLog('load.threadPage', {
    mailbox: mailboxPath,
    threadId,
    messages: body.messages.length,
    attachments: attachments.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
