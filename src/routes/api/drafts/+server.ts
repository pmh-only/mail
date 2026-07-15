import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { imapJob, mailDraft } from '$lib/server/db/schema'
import { parseComposerAttachments } from '$lib/mail-attachments'
import { logServerEvent } from '$lib/server/perf'
import { desc, eq } from 'drizzle-orm'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { isDemoModeEnabled, listDemoDrafts, saveDemoDraft } from '$lib/server/demo'
import { draftJobDedupeKey } from '$lib/imap-sync'

export const GET: RequestHandler = async () => {
  const startedAt = perfNow()
  if (isDemoModeEnabled()) {
    const body = {
      drafts: listDemoDrafts().map((draft) => ({
        id: draft.id,
        toAddr: draft.toAddr,
        subject: draft.subject,
        updatedAt: draft.updatedAt.toISOString()
      }))
    }

    perfLog('api.drafts.GET', {
      rows: body.drafts.length,
      payloadBytes: payloadBytes(body),
      ms: perfMs(startedAt)
    })

    return json(body)
  }

  const drafts = await db
    .select({
      id: mailDraft.id,
      toAddr: mailDraft.toAddr,
      subject: mailDraft.subject,
      updatedAt: mailDraft.updatedAt
    })
    .from(mailDraft)
    .orderBy(desc(mailDraft.updatedAt))

  const body = {
    drafts: drafts.map((d: (typeof drafts)[number]) => ({
      id: d.id,
      toAddr: d.toAddr,
      subject: d.subject,
      updatedAt: d.updatedAt?.toISOString() ?? new Date().toISOString()
    }))
  }

  perfLog('api.drafts.GET', {
    rows: body.drafts.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return json(body)
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const now = new Date()
  const parsedAttachments = parseComposerAttachments(body.attachments)

  if (!parsedAttachments.ok) {
    return error(400, parsedAttachments.error)
  }

  if (isDemoModeEnabled()) {
    return json(
      saveDemoDraft(body as Record<string, unknown>, JSON.stringify(parsedAttachments.attachments))
    )
  }

  const id = typeof body.id === 'number' ? body.id : null

  if (id !== null) {
    // Update existing draft
    const existing = await db.select().from(mailDraft).where(eq(mailDraft.id, id)).limit(1)
    if (existing.length > 0) {
      await db.transaction(async (tx) => {
        await tx
          .update(mailDraft)
          .set({
            toAddr: body.to ?? '',
            cc: body.cc ?? '',
            bcc: body.bcc ?? '',
            subject: body.subject ?? '',
            html: body.html ?? '',
            attachments: JSON.stringify(parsedAttachments.attachments),
            inReplyTo: body.inReplyTo ?? null,
            imapSyncError: null,
            updatedAt: now
          })
          .where(eq(mailDraft.id, id))
        await tx
          .insert(imapJob)
          .values({
            type: 'append_draft',
            mailbox: existing[0].imapMailbox ?? '',
            uid: null,
            draftId: id,
            status: 'pending',
            dedupeKey: draftJobDedupeKey(id),
            attemptCount: 0,
            availableAt: now,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: imapJob.dedupeKey,
            set: {
              type: 'append_draft',
              status: 'pending',
              attemptCount: 0,
              availableAt: now,
              lastError: null,
              updatedAt: now
            }
          })
      })
      return json({ id, updatedAt: now.toISOString() })
    }
  }

  // Insert new draft
  const inserted = await db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(mailDraft)
      .values({
        toAddr: body.to ?? '',
        cc: body.cc ?? '',
        bcc: body.bcc ?? '',
        subject: body.subject ?? '',
        html: body.html ?? '',
        attachments: JSON.stringify(parsedAttachments.attachments),
        inReplyTo: body.inReplyTo ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning({ id: mailDraft.id })
    if (!draft) return null
    await tx.insert(imapJob).values({
      type: 'append_draft',
      mailbox: '',
      uid: null,
      draftId: draft.id,
      status: 'pending',
      dedupeKey: draftJobDedupeKey(draft.id),
      attemptCount: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now
    })
    return draft
  })

  if (!inserted) {
    logServerEvent('api.drafts.POST.insertReturnedEmpty', { hasId: id !== null })
    return error(500, 'Failed to save draft')
  }

  return json({ id: inserted.id, updatedAt: now.toISOString() })
}
