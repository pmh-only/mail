import { randomUUID } from 'node:crypto'
import { and, eq, inArray, lte, or } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { env } from '$lib/server/env-private'
import {
  getImapConfigs,
  getSmtpConfig,
  getSmtpConfigs,
  type ImapConfig,
  type SmtpConfig
} from './config'
import { parseAddressFields, upsertContacts } from './contacts'
import { db } from './db'
import { mailboxCatalog, mailMessage, mailMessageMailbox, smtpJob } from './db/schema'
import { logServerError } from './perf'
import { isAuthError, withRetry } from './retry'
import { sentMailboxForPayload, type SmtpSendOperationPayload } from './smtp-operations'
import {
  clearSignText,
  detachedSignText,
  encryptPgpMime,
  signPgpMime,
  type OpenPgpSigningMethod
} from './openpgp-message'
import { getEncryptionKeysForAddresses, getOpenPgpKeyForAddress } from './openpgp-keys'
import {
  outgoingListHeaders,
  outgoingMessageBody,
  outgoingSenderAddress
} from './outgoing-message.ts'
import {
  getWorkerConnection,
  invalidateWorkerConnection,
  wakeMailboxSync
} from './imap-connections'
import {
  selectSentImapConfig,
  messageIdFromRawMessage,
  SMTP_JOB_HEADER,
  storeSentMessage,
  withoutBccHeader
} from './sent-message'
import { startBackgroundAction, waitForBackgroundActions } from './background-actions'
import { addEmailTrackingPixel, emailTrackingPixelUrl } from './email-tracking'

const MAX_JOB_ATTEMPTS = 8
const PERMANENT_SMTP_ERROR_RE =
  /\b(invalid recipient|mailbox unavailable|user unknown|relay access denied)\b/i

type SmtpJobRow = typeof smtpJob.$inferSelect

const activeOperations = new Map<number, Promise<void>>()

function nextAttemptDelayMs(attemptCount: number) {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attemptCount, 8))
}

function isPermanentSmtpError(error: unknown) {
  if (error instanceof SyntaxError) return true
  const message = error instanceof Error ? error.message : String(error)
  return (
    isAuthError(error) ||
    message.startsWith('Invalid SMTP payload') ||
    message.startsWith('Missing SMTP config') ||
    PERMANENT_SMTP_ERROR_RE.test(message)
  )
}

function parsePayload(job: SmtpJobRow): SmtpSendOperationPayload {
  const payload = JSON.parse(job.payload) as Partial<SmtpSendOperationPayload>
  if (typeof payload.to !== 'string' || !payload.to.trim()) {
    throw new Error('Invalid SMTP payload: missing to')
  }
  if (typeof payload.subject !== 'string' || !payload.subject.trim()) {
    throw new Error('Invalid SMTP payload: missing subject')
  }
  if (!Array.isArray(payload.attachments)) {
    throw new Error('Invalid SMTP payload: missing attachments')
  }

  return {
    to: payload.to,
    cc: payload.cc ?? null,
    bcc: payload.bcc ?? null,
    subject: payload.subject,
    html: payload.html ?? null,
    inReplyTo: payload.inReplyTo ?? null,
    smtpServerId: payload.smtpServerId ?? null,
    fromName: payload.fromName ?? null,
    attachments: payload.attachments,
    openPgpSigning: (['none', 'cleartext', 'detached', 'pgp-mime'].includes(
      payload.openPgpSigning ?? ''
    )
      ? payload.openPgpSigning
      : 'none') as OpenPgpSigningMethod,
    openPgpEncrypt: payload.openPgpEncrypt === true,
    attachPublicKey: payload.attachPublicKey === true,
    trackingOrigin: typeof payload.trackingOrigin === 'string' ? payload.trackingOrigin : null
  }
}

async function resolveSmtpConfig(serverId?: string | null): Promise<SmtpConfig> {
  if (serverId) {
    const configs = await getSmtpConfigs()
    const config = configs.find((candidate) => candidate.id === serverId)
    if (config) return config
    throw new Error(`Missing SMTP config: ${serverId}`)
  }

  const config = await getSmtpConfig()
  if ('missing' in config) {
    throw new Error(`Missing SMTP config: ${config.missing.join(', ')}`)
  }
  return config
}

async function markJobRunning(job: SmtpJobRow) {
  const [updated] = await db
    .update(smtpJob)
    .set({
      status: 'running',
      updatedAt: new Date(),
      lastError: null
    })
    .where(and(eq(smtpJob.id, job.id), eq(smtpJob.status, 'pending')))
    .returning({ id: smtpJob.id })
  return Boolean(updated)
}

async function markJobDone(job: SmtpJobRow) {
  await db
    .update(smtpJob)
    .set({
      status: 'done',
      updatedAt: new Date(),
      lastError: null,
      rawMessage: null
    })
    .where(eq(smtpJob.id, job.id))
}

async function failJob(job: SmtpJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const attemptCount = job.attemptCount + 1

  if (isPermanentSmtpError(error) || attemptCount >= MAX_JOB_ATTEMPTS) {
    await db
      .update(smtpJob)
      .set({
        status: 'failed',
        attemptCount,
        updatedAt: new Date(),
        lastError: message
      })
      .where(eq(smtpJob.id, job.id))
    return
  }

  await db
    .update(smtpJob)
    .set({
      status: 'pending',
      attemptCount,
      updatedAt: new Date(),
      availableAt: new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
      lastError: message
    })
    .where(eq(smtpJob.id, job.id))
}

async function buildRawMessage(
  job: SmtpJobRow,
  payload: SmtpSendOperationPayload,
  smtpConfig: SmtpConfig
) {
  const attachments: Array<{
    filename: string
    contentType: string
    content: Buffer | string
    size?: number
  }> = payload.attachments.map((attachment) => {
    if (!attachment.contentBase64)
      throw new Error(`Attachment content is missing for ${attachment.name}`)
    const content = Buffer.from(attachment.contentBase64, 'base64')
    if (content.byteLength !== attachment.size) {
      throw new Error(`Attachment size mismatch for ${attachment.name}`)
    }

    return {
      filename: attachment.name,
      contentType: attachment.contentType,
      content,
      size: attachment.size
    }
  })

  const [parent] = payload.inReplyTo
    ? await db
        .select({ references: mailMessage.references })
        .from(mailMessage)
        .where(eq(mailMessage.messageId, payload.inReplyTo))
        .limit(1)
    : []
  const references = payload.inReplyTo
    ? [...(parent?.references?.split(/\s+/).filter(Boolean) ?? []), payload.inReplyTo]
    : undefined

  const openPgpKey =
    payload.openPgpSigning !== 'none' || payload.openPgpEncrypt || payload.attachPublicKey
      ? await getOpenPgpKeyForAddress(outgoingSenderAddress(smtpConfig.from))
      : null
  if ((payload.openPgpSigning !== 'none' || payload.openPgpEncrypt) && !openPgpKey) {
    throw new Error('Invalid SMTP payload: no OpenPGP private key matches the sender address')
  }
  if (payload.attachPublicKey && openPgpKey) {
    attachments.push({
      filename: `public-key-${openPgpKey.publicKey.getFingerprint().slice(-16)}.asc`,
      contentType: 'application/pgp-keys',
      content: openPgpKey.armoredPublicKey
    })
  }

  const body = outgoingMessageBody(payload.html)
  const trackingPixelUrl =
    emailTrackingPixelUrl(payload.trackingOrigin ?? undefined, job.trackingToken) ??
    emailTrackingPixelUrl(env.ORIGIN, job.trackingToken)
  if (body.html && trackingPixelUrl) {
    body.html = addEmailTrackingPixel(body.html, trackingPixelUrl)
  }
  if (!payload.openPgpEncrypt && payload.openPgpSigning === 'cleartext' && openPgpKey) {
    body.text = await clearSignText(body.text ?? '', openPgpKey.privateKey)
    delete body.html
  } else if (!payload.openPgpEncrypt && payload.openPgpSigning === 'detached' && openPgpKey) {
    attachments.push({
      filename: 'signature.asc',
      contentType: 'application/pgp-signature',
      content: await detachedSignText(body.text ?? '', openPgpKey.privateKey)
    })
  }

  const mailOptions = {
    messageId: job.messageId || undefined,
    from: payload.fromName
      ? { name: payload.fromName, address: outgoingSenderAddress(smtpConfig.from) }
      : smtpConfig.from,
    to: payload.to,
    cc: payload.cc || undefined,
    bcc: payload.bcc || undefined,
    subject: payload.subject,
    ...body,
    inReplyTo: payload.inReplyTo || undefined,
    references,
    headers: {
      ...outgoingListHeaders(smtpConfig.from),
      [SMTP_JOB_HEADER]: String(job.id)
    },
    attachments: attachments.length > 0 ? attachments : undefined
  }

  const builder = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows'
  })
  const built = await builder.sendMail(mailOptions)
  let raw = Buffer.isBuffer(built.message)
    ? built.message
    : Buffer.from(built.message as unknown as Uint8Array)
  if (payload.openPgpEncrypt) {
    const recipientEmails = parseAddressFields([payload.to, payload.cc, payload.bcc]).map(
      (recipient) => recipient.email
    )
    const encryption = await getEncryptionKeysForAddresses(recipientEmails)
    if (encryption.missing.length > 0) {
      throw new Error(
        `Invalid SMTP payload: missing OpenPGP keys for ${encryption.missing.join(', ')}`
      )
    }
    raw = await encryptPgpMime(
      raw,
      Array.from(
        new Map(
          [...encryption.keys, openPgpKey!.publicKey].map((key) => [key.getFingerprint(), key])
        ).values()
      ),
      payload.openPgpSigning !== 'none' ? openPgpKey?.privateKey : undefined
    )
  } else if (payload.openPgpSigning === 'pgp-mime' && openPgpKey) {
    raw = await signPgpMime(raw, openPgpKey.privateKey)
  }

  return raw
}

async function deliverMessage(
  raw: Buffer,
  payload: SmtpSendOperationPayload,
  smtpConfig: SmtpConfig
) {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    tls: { rejectUnauthorized: !smtpConfig.allowInvalidCertificate },
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password
    }
  })

  await withRetry(
    () =>
      transporter.sendMail({
        raw: withoutBccHeader(raw),
        envelope: {
          from: outgoingSenderAddress(smtpConfig.from),
          to: parseAddressFields([payload.to, payload.cc, payload.bcc]).map(
            (recipient) => recipient.email
          )
        }
      }),
    { label: 'smtp sendMail', maxAttempts: 3, baseDelayMs: 1000 }
  )
}

async function connectImap(config: ImapConfig) {
  return withRetry(() => getWorkerConnection(config), {
    label: `append sent message for ${config.name}`,
    maxAttempts: 3,
    baseDelayMs: 1000
  })
}

async function saveSentCopy(
  job: SmtpJobRow,
  smtpConfig: SmtpConfig,
  raw: Buffer,
  deliveredAt: Date
) {
  const imapConfig = selectSentImapConfig(smtpConfig, await getImapConfigs())
  if (!imapConfig) throw new Error('Missing IMAP config for Sent mailbox')

  let client = null
  try {
    client = await connectImap(imapConfig)
    const mailbox = await storeSentMessage(client, raw, job.id, deliveredAt)
    wakeMailboxSync(imapConfig.id, mailbox)
    const [catalogMailbox] = await db
      .select({ path: mailboxCatalog.path })
      .from(mailboxCatalog)
      .where(
        and(
          eq(mailboxCatalog.configId, imapConfig.id),
          or(eq(mailboxCatalog.remotePath, mailbox), eq(mailboxCatalog.path, mailbox))
        )
      )
      .limit(1)
    return catalogMailbox?.path ?? job.sentMailbox ?? null
  } catch (error) {
    if (client) invalidateWorkerConnection(imapConfig.id, client)
    throw error
  }
}

async function ensureJobIdentity(job: SmtpJobRow, payload: SmtpSendOperationPayload) {
  if (job.messageId && (job.trackingToken || job.deliveredAt)) return
  if (!job.messageId) {
    job.messageId = job.deliveredAt
      ? job.rawMessage
        ? messageIdFromRawMessage(job.rawMessage)
        : null
      : `<pmail-${randomUUID()}@mail.local>`
  }
  if (!job.messageId) return
  if (!job.deliveredAt) job.trackingToken ??= randomUUID()
  job.sentMailbox = await sentMailboxForPayload(payload)
  const [storedCopy] = job.sentMailbox
    ? await db
        .select({ id: mailMessageMailbox.id })
        .from(mailMessageMailbox)
        .where(
          and(
            eq(mailMessageMailbox.messageId, job.messageId),
            eq(mailMessageMailbox.mailbox, job.sentMailbox)
          )
        )
        .limit(1)
    : []
  job.placeholderActive = job.sentMailbox !== null && !storedCopy
  await db
    .update(smtpJob)
    .set({
      messageId: job.messageId,
      trackingToken: job.trackingToken,
      sentMailbox: job.sentMailbox,
      placeholderActive: job.placeholderActive,
      updatedAt: new Date()
    })
    .where(eq(smtpJob.id, job.id))
}

async function runJob(job: SmtpJobRow) {
  const payload = parsePayload(job)
  const smtpConfig = await resolveSmtpConfig(payload.smtpServerId)
  await ensureJobIdentity(job, payload)
  let raw = job.rawMessage
  let deliveredAt = job.deliveredAt

  if (!deliveredAt) {
    raw = await buildRawMessage(job, payload, smtpConfig)
    await deliverMessage(raw, payload, smtpConfig)
    deliveredAt = new Date()
    await db
      .update(smtpJob)
      .set({ deliveredAt, rawMessage: raw, updatedAt: deliveredAt })
      .where(eq(smtpJob.id, job.id))
  } else if (!raw) {
    throw new Error(`SMTP job ${job.id} is missing its delivered message`)
  }

  const sentMailbox = await saveSentCopy(job, smtpConfig, raw, deliveredAt)
  if (sentMailbox && sentMailbox !== job.sentMailbox) {
    await db
      .update(smtpJob)
      .set({ sentMailbox, updatedAt: new Date() })
      .where(eq(smtpJob.id, job.id))
  }

  await upsertContacts(
    parseAddressFields([payload.to, payload.cc, payload.bcc]).map((contact) => ({
      ...contact,
      source: 'auto' as const,
      useCount: 1,
      lastUsedAt: new Date()
    }))
  )
}

async function runOperation(job: SmtpJobRow) {
  try {
    await runJob(job)
    await markJobDone(job)
  } catch (error) {
    logServerError('smtpOperation.send', error, {
      jobId: job.id,
      attemptCount: job.attemptCount
    })
    await failJob(job, error)
  }
}

function startOperation(job: SmtpJobRow) {
  startBackgroundAction(
    activeOperations,
    job.id,
    () => runOperation(job),
    (error) => {
      logServerError('smtpOperation.unhandled', error, { jobId: job.id })
    }
  )
}

export async function dispatchReadySmtpOperations() {
  const jobs = await db
    .select()
    .from(smtpJob)
    .where(and(eq(smtpJob.status, 'pending'), lte(smtpJob.availableAt, new Date())))

  const claims = await Promise.all(
    jobs.map(async (job) => ((await markJobRunning(job)) ? job : null))
  )
  const claimed = claims.filter((job): job is SmtpJobRow => job !== null)
  for (const job of claimed) startOperation(job)
  return claimed.length
}

export async function recoverInterruptedSmtpJobs() {
  if (!emailTrackingPixelUrl(env.ORIGIN, randomUUID())) {
    console.warn('[smtp] ORIGIN is missing or invalid; outgoing email read tracking is disabled')
  }
  const interruptedOrQueued = await db
    .select()
    .from(smtpJob)
    .where(inArray(smtpJob.status, ['pending', 'running']))
  await db
    .update(smtpJob)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(smtpJob.status, 'running'))

  for (const job of interruptedOrQueued) {
    try {
      await ensureJobIdentity(job, parsePayload(job))
    } catch (error) {
      logServerError('smtpOperation.recoverIdentity', error, { jobId: job.id })
    }
  }
}

export async function waitForSmtpOperations() {
  await waitForBackgroundActions(activeOperations)
}
