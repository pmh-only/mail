import { db } from './db'
import { imapJob } from './db/schema'
import { seenJob } from '../imap-sync'

async function enqueueSeenState(uid: number, mailbox: string, seen: boolean) {
  const now = new Date()
  const job = seenJob(uid, mailbox, seen)
  await db
    .insert(imapJob)
    .values({
      type: job.type,
      mailbox,
      uid,
      targetMailbox: null,
      status: 'pending',
      dedupeKey: job.dedupeKey,
      attemptCount: 0,
      availableAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: imapJob.dedupeKey,
      set: {
        type: job.type,
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now
      }
    })
}

export function enqueueMarkRead(uid: number, mailbox: string) {
  return enqueueSeenState(uid, mailbox, true)
}

export function enqueueMarkUnread(uid: number, mailbox: string) {
  return enqueueSeenState(uid, mailbox, false)
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

export async function enqueueAddFlag(uid: number, mailbox: string, flag: string) {
  const now = new Date()
  await db
    .insert(imapJob)
    .values({
      type: 'add_flag',
      mailbox,
      uid,
      targetMailbox: flag,
      status: 'pending',
      dedupeKey: `add_flag:${mailbox}:${uid}:${flag}`,
      attemptCount: 0,
      availableAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: imapJob.dedupeKey,
      set: {
        targetMailbox: flag,
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now
      }
    })
}
