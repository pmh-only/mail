import { and, asc, count, eq, inArray, lte } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { getSmtpConfig, getSmtpConfigs, type SmtpConfig } from './config'
import { parseAddressFields, upsertContacts } from './contacts'
import { db } from './db'
import { mailMessage, smtpJob } from './db/schema'
import { logServerError } from './perf'
import { isAuthError, withRetry } from './retry'
import type { SmtpSendJobPayload } from './smtp-queue'

const MAX_JOB_ATTEMPTS = 8
const PERMANENT_SMTP_ERROR_RE =
  /\b(invalid recipient|mailbox unavailable|user unknown|relay access denied)\b/i

type SmtpJobRow = typeof smtpJob.$inferSelect

let drainInFlight = false

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

function parsePayload(job: SmtpJobRow): SmtpSendJobPayload {
  const payload = JSON.parse(job.payload) as Partial<SmtpSendJobPayload>
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
    attachments: payload.attachments
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

function extractAddress(value: string) {
  const match = value.match(/<([^>]+)>/)
  return match?.[1]?.trim() || value.trim()
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
      lastError: null
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

async function runJob(job: SmtpJobRow) {
  const payload = parsePayload(job)
  const smtpConfig = await resolveSmtpConfig(payload.smtpServerId)
  const attachments = payload.attachments.map((attachment) => {
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

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password
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

  await withRetry(
    () =>
      transporter.sendMail({
        from: payload.fromName
          ? { name: payload.fromName, address: extractAddress(smtpConfig.from) }
          : smtpConfig.from,
        to: payload.to,
        cc: payload.cc || undefined,
        bcc: payload.bcc || undefined,
        subject: payload.subject,
        html: payload.html ?? undefined,
        inReplyTo: payload.inReplyTo || undefined,
        references,
        attachments: attachments.length > 0 ? attachments : undefined
      }),
    { label: 'smtp sendMail', maxAttempts: 3, baseDelayMs: 1000 }
  )

  await upsertContacts(
    parseAddressFields([payload.to, payload.cc, payload.bcc]).map((contact) => ({
      ...contact,
      source: 'auto' as const,
      useCount: 1,
      lastUsedAt: new Date()
    }))
  )
}

async function drainQueueOnce(): Promise<boolean> {
  const [job] = await db
    .select()
    .from(smtpJob)
    .where(and(eq(smtpJob.status, 'pending'), lte(smtpJob.availableAt, new Date())))
    .orderBy(asc(smtpJob.availableAt), asc(smtpJob.createdAt))
    .limit(1)

  if (!job) return false

  if (!(await markJobRunning(job))) return true

  try {
    await runJob(job)
    await markJobDone(job)
  } catch (error) {
    logServerError('smtpQueue.send', error, {
      jobId: job.id,
      attemptCount: job.attemptCount
    })
    await failJob(job, error)
  }

  return true
}

export async function recoverInterruptedSmtpJobs() {
  await db
    .update(smtpJob)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(smtpJob.status, 'running'))
}

export async function hasUnfinishedSmtpJobs() {
  const [row] = await db
    .select({ value: count() })
    .from(smtpJob)
    .where(inArray(smtpJob.status, ['pending', 'running']))
  return Number(row?.value ?? 0) > 0
}

export async function drainSmtpQueue() {
  if (drainInFlight) return 0
  drainInFlight = true

  let processed = 0
  try {
    while (await drainQueueOnce()) {
      processed += 1
    }
  } finally {
    drainInFlight = false
  }

  return processed
}
