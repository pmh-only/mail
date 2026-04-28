import { and, asc, eq, lte } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { getImapConfig, type ImapConfig } from './config'
import { db } from './db'
import { imapJob } from './db/schema'
import { logServerError } from './perf'
import { isAuthError, withRetry } from './retry'

const IMAP_CONNECT_TIMEOUT_MS = 20_000
const JOB_POLL_INTERVAL_MS = 1_000
const MAX_JOB_ATTEMPTS = 8
const PERMANENT_JOB_ERROR_RE =
  /\b(no such mailbox|unknown mailbox|invalid mailbox|mailbox does not exist)\b/i

type MailConfig = Pick<ImapConfig, 'host' | 'port' | 'secure' | 'user' | 'password'>
type ImapJobRow = typeof imapJob.$inferSelect

let jobWorkerTimer: ReturnType<typeof setInterval> | null = null
let drainInFlight = false

async function connectImap(config: MailConfig, label: string): Promise<ImapFlow> {
  return withRetry(
    async () => {
      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        logger: false,
        connectionTimeout: IMAP_CONNECT_TIMEOUT_MS
      })
      try {
        await client.connect()
        return client
      } catch (err) {
        try {
          client.close()
        } catch {
          /* ignore */
        }
        throw err
      }
    },
    { label, maxAttempts: 3, baseDelayMs: 1000 }
  )
}

function nextAttemptDelayMs(attemptCount: number) {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attemptCount, 8))
}

function isPermanentJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return isAuthError(error) || PERMANENT_JOB_ERROR_RE.test(message)
}

function toConfig(config: ImapConfig): MailConfig {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    password: config.password
  }
}

async function markJobRunning(job: ImapJobRow) {
  await db
    .update(imapJob)
    .set({
      status: 'running',
      updatedAt: new Date(),
      lastError: null
    })
    .where(eq(imapJob.id, job.id))
}

async function markJobDone(job: ImapJobRow) {
  await db
    .update(imapJob)
    .set({
      status: 'done',
      updatedAt: new Date(),
      lastError: null
    })
    .where(eq(imapJob.id, job.id))
}

async function failJob(job: ImapJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const attemptCount = job.attemptCount + 1

  if (isPermanentJobError(error) || attemptCount >= MAX_JOB_ATTEMPTS) {
    await db
      .update(imapJob)
      .set({
        status: 'failed',
        attemptCount,
        updatedAt: new Date(),
        lastError: message
      })
      .where(eq(imapJob.id, job.id))
    return
  }

  await db
    .update(imapJob)
    .set({
      status: 'pending',
      attemptCount,
      updatedAt: new Date(),
      availableAt: new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
      lastError: message
    })
    .where(eq(imapJob.id, job.id))
}

async function runMarkRead(config: MailConfig, job: ImapJobRow) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `mark-read ${job.mailbox}`)
    const lock = await client.getMailboxLock(job.mailbox)
    try {
      await client.messageFlagsAdd(String(job.uid), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}

async function runMarkUnread(config: MailConfig, job: ImapJobRow) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `mark-unread ${job.mailbox}`)
    const lock = await client.getMailboxLock(job.mailbox)
    try {
      await client.messageFlagsRemove(String(job.uid), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}

async function runMove(config: MailConfig, job: ImapJobRow) {
  if (!job.targetMailbox) {
    throw new Error('Missing target mailbox for move job')
  }

  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `move ${job.mailbox}→${job.targetMailbox}`)
    const lock = await client.getMailboxLock(job.mailbox)
    try {
      await client.messageMove(String(job.uid), job.targetMailbox, { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}

async function runJob(job: ImapJobRow) {
  const config = await getImapConfig()
  if ('missing' in config) {
    throw new Error(`Missing IMAP config: ${config.missing.join(', ')}`)
  }

  if (job.type === 'mark_read') {
    await runMarkRead(toConfig(config), job)
    return
  }

  if (job.type === 'mark_unread') {
    await runMarkUnread(toConfig(config), job)
    return
  }

  if (job.type === 'move') {
    await runMove(toConfig(config), job)
    return
  }

  throw new Error(`Unknown IMAP job type: ${job.type}`)
}

async function drainQueueOnce(): Promise<boolean> {
  const [job] = await db
    .select()
    .from(imapJob)
    .where(and(eq(imapJob.status, 'pending'), lte(imapJob.availableAt, new Date())))
    .orderBy(asc(imapJob.availableAt), asc(imapJob.createdAt))
    .limit(1)

  if (!job) return false

  await markJobRunning(job)

  try {
    await runJob(job)
    await markJobDone(job)
  } catch (error) {
    logServerError(`imapQueue.${job.type}`, error, {
      mailbox: job.mailbox,
      uid: job.uid,
      targetMailbox: job.targetMailbox ?? null,
      attemptCount: job.attemptCount
    })
    await failJob(job, error)
  }

  return true
}

async function drainQueue() {
  if (drainInFlight) return
  drainInFlight = true

  try {
    while (await drainQueueOnce()) {
      // Drain until queue is empty.
    }
  } finally {
    drainInFlight = false
  }
}

export async function enqueueMarkRead(uid: number, mailbox: string) {
  const now = new Date()
  await db
    .insert(imapJob)
    .values({
      type: 'mark_read',
      mailbox,
      uid,
      targetMailbox: null,
      status: 'pending',
      dedupeKey: `mark_read:${mailbox}:${uid}`,
      attemptCount: 0,
      availableAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: imapJob.dedupeKey,
      set: {
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now
      }
    })
}

export async function enqueueMarkUnread(uid: number, mailbox: string) {
  const now = new Date()
  await db
    .insert(imapJob)
    .values({
      type: 'mark_unread',
      mailbox,
      uid,
      targetMailbox: null,
      status: 'pending',
      dedupeKey: `mark_unread:${mailbox}:${uid}`,
      attemptCount: 0,
      availableAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: imapJob.dedupeKey,
      set: {
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now
      }
    })
}

export async function enqueueMoveMessage(
  uid: number,
  sourceMailbox: string,
  targetMailbox: string
) {
  const now = new Date()
  await db
    .insert(imapJob)
    .values({
      type: 'move',
      mailbox: sourceMailbox,
      uid,
      targetMailbox,
      status: 'pending',
      dedupeKey: `move:${sourceMailbox}:${uid}`,
      attemptCount: 0,
      availableAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: imapJob.dedupeKey,
      set: {
        targetMailbox,
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now
      }
    })
}

export function startImapJobWorker() {
  if (jobWorkerTimer) return

  void drainQueue()
  jobWorkerTimer = setInterval(() => {
    void drainQueue()
  }, JOB_POLL_INTERVAL_MS)
}
