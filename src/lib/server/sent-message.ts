import type { ImapFlow } from 'imapflow'
import type { ImapConfig, SmtpConfig } from './config'

export const SMTP_JOB_HEADER = 'X-Pmail-Smtp-Job-ID'

type SentMailbox = {
  path: string
  configId?: string | null
  specialUse?: string | null
  flags?: Set<string> | null
}

type SentMessageClient = Pick<ImapFlow, 'append' | 'getMailboxLock' | 'list' | 'search'>

function normalizedAddress(value: string) {
  return (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase()
}

export function withoutBccHeader(rawMessage: Buffer) {
  const crlfSeparator = Buffer.from('\r\n\r\n')
  const lfSeparator = Buffer.from('\n\n')
  let separator = crlfSeparator
  let headerEnd = rawMessage.indexOf(separator)
  if (headerEnd < 0) {
    separator = lfSeparator
    headerEnd = rawMessage.indexOf(separator)
  }
  if (headerEnd < 0) return rawMessage

  const newline = separator === crlfSeparator ? '\r\n' : '\n'
  const filteredHeaders: string[] = []
  let removingBcc = false
  for (const line of rawMessage.subarray(0, headerEnd).toString('utf8').split(newline)) {
    if (/^[\t ]/.test(line)) {
      if (!removingBcc) filteredHeaders.push(line)
      continue
    }
    removingBcc = /^bcc\s*:/i.test(line)
    if (!removingBcc) filteredHeaders.push(line)
  }

  return Buffer.concat([
    Buffer.from(filteredHeaders.join(newline), 'utf8'),
    separator,
    rawMessage.subarray(headerEnd + separator.length)
  ])
}

export function messageIdFromRawMessage(rawMessage: Buffer) {
  const headerEnd = rawMessage.indexOf(Buffer.from('\r\n\r\n'))
  const headers = rawMessage.subarray(0, headerEnd >= 0 ? headerEnd : rawMessage.length).toString()
  const match = headers.match(/^message-id\s*:\s*([^\r\n]*(?:\r?\n[\t ][^\r\n]*)*)/im)
  return match?.[1]?.replace(/\r?\n[\t ]+/g, ' ').trim() || null
}

export function selectSentImapConfig(smtpConfig: SmtpConfig, imapConfigs: ImapConfig[]) {
  return (
    imapConfigs.find((config) => config.id === smtpConfig.id) ??
    imapConfigs.find(
      (config) => normalizedAddress(config.user) === normalizedAddress(smtpConfig.from)
    ) ??
    imapConfigs.find(
      (config) => normalizedAddress(config.user) === normalizedAddress(smtpConfig.user)
    ) ??
    (imapConfigs.length === 1 ? imapConfigs[0] : null)
  )
}

export function findSentMailbox(mailboxes: SentMailbox[]) {
  return (
    mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent' || mailbox.flags?.has('\\Sent'))
      ?.path ??
    mailboxes.find((mailbox) =>
      /(^|[/_. -])sent([_. -]?(mail|items|messages))?$/i.test(mailbox.path)
    )?.path ??
    null
  )
}

export function findSentMailboxForAccount(
  mailboxes: SentMailbox[],
  configId: string,
  accountCount: number
) {
  return findSentMailbox(
    mailboxes.filter(
      (mailbox) => mailbox.configId === configId || (accountCount === 1 && mailbox.configId == null)
    )
  )
}

async function findExistingCopy(client: SentMessageClient, jobId: number) {
  const matches = await client.search(
    { header: { [SMTP_JOB_HEADER]: String(jobId) } },
    { uid: true }
  )
  if (!matches) throw new Error(`Failed to search Sent mailbox for SMTP job ${jobId}`)
  return matches.length > 0
}

export async function storeSentMessage(
  client: SentMessageClient,
  rawMessage: Buffer,
  jobId: number,
  deliveredAt: Date
) {
  const mailbox = findSentMailbox(await client.list())
  if (!mailbox) throw new Error('Sent mailbox not found')

  const lock = await client.getMailboxLock(mailbox)
  try {
    if (await findExistingCopy(client, jobId)) return mailbox

    const appended = await client.append(mailbox, rawMessage, ['\\Seen'], deliveredAt)
    if (!appended && !(await findExistingCopy(client, jobId))) {
      throw new Error(`Failed to persist SMTP job ${jobId} in ${mailbox}`)
    }
    return mailbox
  } finally {
    lock.release()
  }
}
