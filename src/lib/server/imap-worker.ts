import { and, eq, lte } from 'drizzle-orm'
import type { ImapFlow } from 'imapflow'
import { getImapConfig, getImapConfigs, type ImapConfig } from './config'
import { db } from './db'
import { imapJob, mailDraft, mailMessage, mailMessageMailbox } from './db/schema'
import { logServerError } from './perf'
import { isAuthError, withRetry } from './retry'
import {
  getWorkerConnection,
  invalidateWorkerConnection,
  wakeMailboxSync
} from './imap-connections'
import { buildDraftMessage } from './draft-message'
import { draftAppendMatches, draftDeleteJob, previousDraftUidToDelete } from '../imap-sync'
import { startBackgroundAction, waitForBackgroundActions } from './background-actions'

const MAX_JOB_ATTEMPTS = 8
const PERMANENT_JOB_ERROR_RE =
  /\b(no such mailbox|unknown mailbox|invalid mailbox|mailbox does not exist|safe move fallback requires uidplus)\b/i

type MailConfig = ImapConfig
type ImapJobRow = typeof imapJob.$inferSelect

type ResolvedImapJob = { config: MailConfig; mailbox: string; targetMailbox: string | null }

const activeOperations = new Map<number, Promise<void>>()

async function connectImap(config: MailConfig, label: string) {
  return withRetry(() => getWorkerConnection(config), {
    label,
    maxAttempts: 3,
    baseDelayMs: 1000
  })
}

function nextAttemptDelayMs(attemptCount: number) {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attemptCount, 8))
}

function isPermanentJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return isAuthError(error) || PERMANENT_JOB_ERROR_RE.test(message)
}

function toConfig(config: ImapConfig): MailConfig {
  return config
}

function jobUid(job: ImapJobRow) {
  if (job.uid === null) throw new Error(`Missing UID for ${job.type} job`)
  return job.uid
}

async function resolveJobTarget(job: ImapJobRow): Promise<ResolvedImapJob> {
  const configs = await getImapConfigs()
  if (configs.length === 0) {
    const config = await getImapConfig()
    if ('missing' in config) throw new Error(`Missing IMAP config: ${config.missing.join(', ')}`)
    configs.push(config)
  }

  for (const config of configs) {
    const prefix = `${config.name}/`
    if (config.id !== 'primary' && job.mailbox.startsWith(prefix)) {
      return {
        config: toConfig(config),
        mailbox: job.mailbox.slice(prefix.length),
        targetMailbox: job.targetMailbox?.startsWith(prefix)
          ? job.targetMailbox.slice(prefix.length)
          : job.targetMailbox
      }
    }
  }

  return { config: toConfig(configs[0]), mailbox: job.mailbox, targetMailbox: job.targetMailbox }
}

async function markJobRunning(job: ImapJobRow) {
  const [running] = await db
    .update(imapJob)
    .set({
      status: 'running',
      updatedAt: new Date(),
      lastError: null
    })
    .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'pending')))
    .returning()
  return running ?? null
}

async function markJobDone(job: ImapJobRow) {
  await db
    .update(imapJob)
    .set({
      status: 'done',
      updatedAt: new Date(),
      lastError: null
    })
    .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'running')))
}

async function failJob(job: ImapJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const attemptCount = job.attemptCount + 1

  await db.transaction(async (tx) => {
    const transitioned = await tx
      .update(imapJob)
      .set(
        isPermanentJobError(error) || attemptCount >= MAX_JOB_ATTEMPTS
          ? {
              status: 'failed',
              attemptCount,
              updatedAt: new Date(),
              lastError: message
            }
          : {
              status: 'pending',
              attemptCount,
              updatedAt: new Date(),
              availableAt: new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
              lastError: message
            }
      )
      .where(and(eq(imapJob.id, job.id), eq(imapJob.status, 'running')))
      .returning({ id: imapJob.id })

    if (transitioned.length > 0 && job.type === 'append_draft' && job.draftId !== null) {
      await tx
        .update(mailDraft)
        .set({ imapSyncError: message })
        .where(eq(mailDraft.id, job.draftId))
    }
  })
}

async function runMarkRead(config: MailConfig, job: ImapJobRow, mailbox = job.mailbox) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `mark-read ${mailbox}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      const updated = await client.messageFlagsAdd(String(jobUid(job)), ['\\Seen'], { uid: true })
      if (!updated) throw new Error(`Failed to mark UID ${jobUid(job)} as read`)
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }
}

async function runMarkUnread(config: MailConfig, job: ImapJobRow, mailbox = job.mailbox) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `mark-unread ${mailbox}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      const updated = await client.messageFlagsRemove(String(jobUid(job)), ['\\Seen'], {
        uid: true
      })
      if (!updated) throw new Error(`Failed to mark UID ${jobUid(job)} as unread`)
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }
}

async function runMove(
  config: MailConfig,
  job: ImapJobRow,
  mailbox = job.mailbox,
  targetMailbox = job.targetMailbox
) {
  if (!targetMailbox) {
    throw new Error('Missing target mailbox for move job')
  }

  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `move ${mailbox} to ${targetMailbox}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      const uid = String(jobUid(job))
      let moved = client.capabilities.has('MOVE')
        ? await client.messageMove(uid, targetMailbox, { uid: true })
        : false
      if (!moved) {
        if (!client.capabilities.has('UIDPLUS')) {
          throw new Error('Safe MOVE fallback requires UIDPLUS')
        }
        const copied = await client.messageCopy(uid, targetMailbox, { uid: true })
        if (!copied) throw new Error(`IMAP COPY fallback failed from ${mailbox}`)
        const deleted = await client.messageDelete(uid, { uid: true })
        if (!deleted) throw new Error(`UID EXPUNGE fallback failed in ${mailbox}`)
        moved = copied
      }
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }

  wakeMailboxSync(config.id, targetMailbox)

  try {
    const uid = jobUid(job)
    const [entry] = await db
      .select({ id: mailMessageMailbox.id, threadKey: mailMessage.threadKey })
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
      .where(and(eq(mailMessageMailbox.mailbox, job.mailbox), eq(mailMessageMailbox.uid, uid)))
      .limit(1)
    if (entry) {
      await db.delete(mailMessageMailbox).where(eq(mailMessageMailbox.id, entry.id))
      const { refreshThreadSummaries } = await import('./mail')
      await refreshThreadSummaries(job.mailbox, [entry.threadKey])
    }
  } catch (error) {
    logServerError('imapOperation.move.localCleanup', error, {
      mailbox: job.mailbox,
      uid: job.uid
    })
  }
}

async function runAddFlag(
  config: MailConfig,
  job: ImapJobRow,
  mailbox = job.mailbox,
  targetMailbox = job.targetMailbox
) {
  if (!targetMailbox) {
    throw new Error('Missing flag for add-flag job')
  }

  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `add-flag ${mailbox}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      const updated = await client.messageFlagsAdd(String(jobUid(job)), [targetMailbox], {
        uid: true
      })
      if (!updated) throw new Error(`Failed to add ${targetMailbox} to UID ${jobUid(job)}`)
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }
}

async function findDraftMailbox(client: ImapFlow) {
  const listed = await client.list()
  const drafts = listed.find(
    (mailbox) => mailbox.specialUse === '\\Drafts' || mailbox.flags?.has('\\Drafts')
  )
  const fallback = listed.find((mailbox) => /(^|[/_. -])drafts?$/i.test(mailbox.path))
  const mailbox = drafts ?? fallback
  if (!mailbox) throw new Error('Drafts mailbox not found')
  return mailbox.path
}

async function findAppendedDraftUids(client: ImapFlow, draftId: number, version: Date) {
  const result = await client.search(
    {
      header: {
        'X-Pmail-Draft-ID': String(draftId),
        'X-Pmail-Draft-Version': version.toISOString()
      }
    },
    { uid: true }
  )
  return result === false ? [] : result
}

async function removeDraftCopy(client: ImapFlow, uid: number) {
  const matches = await client.search({ uid: String(uid) }, { uid: true })
  if (matches === false) throw new Error(`Failed to find draft UID ${uid}`)
  if (matches.length === 0) return
  const deleted = await client.messageDelete(String(uid), { uid: true })
  if (!deleted) throw new Error(`Failed to delete old draft UID ${uid}`)
}

async function runAppendDraft(config: MailConfig, job: ImapJobRow) {
  if (job.draftId === null) throw new Error('Missing draft ID for append job')
  const [draft] = await db.select().from(mailDraft).where(eq(mailDraft.id, job.draftId)).limit(1)
  if (!draft) return

  const attachments = JSON.parse(draft.attachments)
  const message = await buildDraftMessage(draft, config.user, attachments)
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `append draft ${draft.id}`)
    const mailbox = draft.imapMailbox || (await findDraftMailbox(client))
    const lock = await client.getMailboxLock(mailbox)
    try {
      let matches = draftAppendMatches(
        await findAppendedDraftUids(client, draft.id, draft.updatedAt)
      )
      let uid = matches.uid
      let uidValidity = client.mailbox ? Number(client.mailbox.uidValidity) : null
      if (uid === null) {
        const appended = await client.append(mailbox, message, ['\\Draft'], draft.updatedAt)
        if (appended && appended.uid) {
          matches = { uid: appended.uid, duplicates: [] }
        } else {
          matches = draftAppendMatches(
            await findAppendedDraftUids(client, draft.id, draft.updatedAt)
          )
        }
        uid = matches.uid
        uidValidity =
          appended && appended.uidValidity
            ? Number(appended.uidValidity)
            : client.mailbox
              ? Number(client.mailbox.uidValidity)
              : null
      }
      if (uid === null) throw new Error(`APPEND result for draft ${draft.id} was ambiguous`)

      for (const duplicateUid of matches.duplicates) {
        await removeDraftCopy(client, duplicateUid)
      }

      const previousUid = previousDraftUidToDelete(
        {
          mailbox: draft.imapMailbox,
          uid: draft.imapUid,
          uidValidity: draft.imapUidValidity
        },
        { mailbox, uid, uidValidity }
      )
      if (previousUid) await removeDraftCopy(client, previousUid)

      const updated = await db
        .update(mailDraft)
        .set({
          imapMailbox: mailbox,
          imapUid: uid,
          imapUidValidity: uidValidity,
          imapSyncedAt: new Date(),
          imapSyncError: null
        })
        .where(and(eq(mailDraft.id, draft.id), eq(mailDraft.updatedAt, draft.updatedAt)))
        .returning({ id: mailDraft.id })
      if (updated.length === 0) {
        const now = new Date()
        await db
          .insert(imapJob)
          .values(draftDeleteJob(draft.id, mailbox, uid, uidValidity, now))
          .onConflictDoNothing()
      }
      wakeMailboxSync(config.id, mailbox)
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }
}

async function runDeleteDraft(config: MailConfig, job: ImapJobRow, mailbox = job.mailbox) {
  const uid = jobUid(job)
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `delete draft ${uid}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      if (
        job.uidValidity !== null &&
        client.mailbox &&
        Number(client.mailbox.uidValidity) !== job.uidValidity
      ) {
        wakeMailboxSync(config.id, mailbox)
        return
      }
      await removeDraftCopy(client, uid)
      wakeMailboxSync(config.id, mailbox)
    } finally {
      lock.release()
    }
  } catch (error) {
    if (client) invalidateWorkerConnection(config.id, client)
    throw error
  }
}

async function runJob(job: ImapJobRow) {
  const target = await resolveJobTarget(job)

  if (job.type === 'mark_read') {
    await runMarkRead(target.config, job, target.mailbox)
    return
  }

  if (job.type === 'mark_unread') {
    await runMarkUnread(target.config, job, target.mailbox)
    return
  }

  if (job.type === 'move') {
    await runMove(target.config, job, target.mailbox, target.targetMailbox)
    return
  }

  if (job.type === 'add_flag') {
    await runAddFlag(target.config, job, target.mailbox, target.targetMailbox)
    return
  }

  if (job.type === 'append_draft') {
    await runAppendDraft(target.config, job)
    return
  }

  if (job.type === 'delete_draft') {
    await runDeleteDraft(target.config, job, target.mailbox)
    return
  }

  throw new Error(`Unknown IMAP job type: ${job.type}`)
}

async function runOperation(job: ImapJobRow) {
  try {
    await runJob(job)
    await markJobDone(job)
  } catch (error) {
    logServerError(`imapOperation.${job.type}`, error, {
      mailbox: job.mailbox,
      uid: job.uid,
      targetMailbox: job.targetMailbox ?? null,
      attemptCount: job.attemptCount
    })
    await failJob(job, error)
  }
}

function startOperation(job: ImapJobRow) {
  startBackgroundAction(
    activeOperations,
    job.id,
    () => runOperation(job),
    (error) => {
      logServerError('imapOperation.unhandled', error, { jobId: job.id })
    }
  )
}

async function runBatchOperation(group: ImapJobRow[]) {
  const first = group[0]
  try {
    const target = await resolveJobTarget(first)
    const isRead = first.type === 'mark_read'
    const uids = group.map((j) => j.uid).filter((uid): uid is number => uid !== null)

    if (uids.length > 0) {
      let client: ImapFlow | null = null
      try {
        client = await connectImap(target.config, `batch-${first.type} ${target.mailbox}`)
        const lock = await client.getMailboxLock(target.mailbox)
        try {
          for (let i = 0; i < uids.length; i += 100) {
            const uidChunk = uids.slice(i, i + 100).join(',')
            const updated = isRead
              ? await client.messageFlagsAdd(uidChunk, ['\\Seen'], { uid: true })
              : await client.messageFlagsRemove(uidChunk, ['\\Seen'], { uid: true })
            if (!updated) {
              throw new Error(`Failed to update flags for UIDs ${uidChunk} in ${target.mailbox}`)
            }
          }
        } finally {
          lock.release()
        }
      } catch (error) {
        if (client) invalidateWorkerConnection(target.config.id, client)
        throw error
      }
    }

    await Promise.all(group.map(markJobDone))
  } catch (error) {
    logServerError(`imapOperation.batch.${first.type}`, error, {
      mailbox: first.mailbox,
      count: group.length
    })
    await Promise.all(group.map((job) => failJob(job, error)))
  }
}

function startBatchOperation(group: ImapJobRow[]) {
  const first = group[0]
  startBackgroundAction(
    activeOperations,
    first.id,
    () => runBatchOperation(group),
    (error) => {
      logServerError('imapOperation.batch.unhandled', error, { jobId: first.id })
    }
  )
}

export async function dispatchReadyImapOperations() {
  const jobs = await db
    .select()
    .from(imapJob)
    .where(and(eq(imapJob.status, 'pending'), lte(imapJob.availableAt, new Date())))
    .limit(50)

  if (jobs.length === 0) return 0

  const claimed = (await Promise.all(jobs.map(markJobRunning))).filter(
    (job): job is ImapJobRow => job !== null
  )

  const batchableJobs = new Map<string, ImapJobRow[]>()
  const unbatchableJobs: ImapJobRow[] = []

  for (const job of claimed) {
    if ((job.type === 'mark_read' || job.type === 'mark_unread') && job.uid !== null) {
      const key = `${job.type}:${job.mailbox}`
      const group = batchableJobs.get(key) ?? []
      group.push(job)
      batchableJobs.set(key, group)
    } else {
      unbatchableJobs.push(job)
    }
  }

  for (const job of unbatchableJobs) {
    startOperation(job)
  }

  for (const group of batchableJobs.values()) {
    if (group.length === 1) {
      startOperation(group[0])
    } else {
      startBatchOperation(group)
    }
  }

  return claimed.length
}

export async function recoverInterruptedImapJobs() {
  await db
    .update(imapJob)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(imapJob.status, 'running'))
}

export async function waitForImapOperations() {
  await waitForBackgroundActions(activeOperations)
}
