import type { ComposerAttachment } from '$lib/mail-attachments'
import { env } from '$lib/server/env-private'
import { randomUUID } from 'node:crypto'
import type { OpenPgpSigningMethod } from './openpgp-message'
import { getImapConfigs, getSmtpConfig, getSmtpConfigs } from './config'
import { db } from './db'
import { mailboxCatalog, smtpJob } from './db/schema'
import { findSentMailboxForAccount, selectSentImapConfig } from './sent-message'

export type SmtpSendOperationPayload = {
  to: string
  cc?: string | null
  bcc?: string | null
  subject: string
  html?: string | null
  inReplyTo?: string | null
  smtpServerId?: string | null
  fromName?: string | null
  attachments: ComposerAttachment[]
  openPgpSigning?: OpenPgpSigningMethod
  openPgpEncrypt?: boolean
  attachPublicKey?: boolean
  trackingOrigin?: string | null
}

export async function sentMailboxForPayload(payload: SmtpSendOperationPayload) {
  const [smtpConfigs, primarySmtpConfig, imapConfigs, mailboxes] = await Promise.all([
    getSmtpConfigs(),
    getSmtpConfig(),
    getImapConfigs(),
    db.select().from(mailboxCatalog)
  ])
  const smtpConfig = payload.smtpServerId
    ? smtpConfigs.find((config) => config.id === payload.smtpServerId)
    : 'missing' in primarySmtpConfig
      ? null
      : primarySmtpConfig
  if (!smtpConfig) return null

  const imapConfig = selectSentImapConfig(smtpConfig, imapConfigs)
  if (!imapConfig) return null
  return findSentMailboxForAccount(mailboxes, imapConfig.id, imapConfigs.length)
}

export async function scheduleSmtpSend(
  payload: SmtpSendOperationPayload,
  availableAt = new Date()
) {
  const now = new Date()
  const messageId = `<pmail-${randomUUID()}@mail.local>`
  const trackingToken = randomUUID()
  const sentMailbox = await sentMailboxForPayload(payload)
  const [job] = await db
    .insert(smtpJob)
    .values({
      payload: JSON.stringify({ ...payload, trackingOrigin: env.ORIGIN ?? null }),
      status: 'pending',
      attemptCount: 0,
      availableAt,
      lastError: null,
      messageId,
      trackingToken,
      sentMailbox,
      placeholderActive: sentMailbox !== null,
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: smtpJob.id })

  return job?.id ?? null
}
