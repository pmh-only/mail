import type { PageServerLoad } from './$types'
import { countStoredMessages, listStoredMessages, resolveMailboxPath } from '$lib/server/mail'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'

const PAGE_SIZE = 50

function serializeMessage(message: Awaited<ReturnType<typeof listStoredMessages>>[number]) {
  return {
    id: message.id,
    messageId: message.messageId,
    mailbox: message.mailbox,
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    preview: message.preview,
    flags: JSON.parse(message.flags) as string[],
    receivedAt: message.receivedAt?.toISOString() ?? null,
    threadId: message.threadId ?? null
  }
}

export const load: PageServerLoad = async ({ params, parent }) => {
  const startedAt = perfNow()
  const { imapMailboxes } = await parent()
  const mailboxPath = await resolveMailboxPath(params.mailbox, imapMailboxes)
  const [rawMessages, total] = await Promise.all([
    listStoredMessages(mailboxPath, PAGE_SIZE + 1, 0),
    countStoredMessages(mailboxPath)
  ])
  const hasMore = rawMessages.length > PAGE_SIZE

  const body = {
    messages: rawMessages.slice(0, PAGE_SIZE).map(serializeMessage),
    hasMore,
    pageSize: PAGE_SIZE,
    total
  }

  perfLog('load.mailboxPage', {
    mailbox: mailboxPath,
    rows: body.messages.length,
    hasMore,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
