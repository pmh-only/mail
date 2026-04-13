import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailDraft } from '$lib/server/db/schema'
import { parseComposerAttachments, summarizeAttachments } from '$lib/mail-attachments'
import { desc, eq } from 'drizzle-orm'

function parseStoredAttachments(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parseComposerAttachments(parsed)
  } catch {
    return { ok: false as const, error: 'Stored draft attachments are invalid' }
  }
}

export const GET: RequestHandler = async () => {
  const drafts = await db.select().from(mailDraft).orderBy(desc(mailDraft.updatedAt))

  return json({
    drafts: drafts.map((d) => {
      const parsedAttachments = parseStoredAttachments(d.attachments)

      return {
        id: d.id,
        toAddr: d.toAddr,
        cc: d.cc,
        bcc: d.bcc,
        subject: d.subject,
        html: d.html,
        attachments: parsedAttachments.ok
          ? summarizeAttachments(parsedAttachments.attachments)
          : [],
        attachmentError: parsedAttachments.ok ? null : parsedAttachments.error,
        inReplyTo: d.inReplyTo,
        updatedAt: d.updatedAt?.toISOString() ?? new Date().toISOString()
      }
    })
  })
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const now = new Date()
  const parsedAttachments = parseComposerAttachments(body.attachments)

  if (!parsedAttachments.ok) {
    return error(400, parsedAttachments.error)
  }

  const id = typeof body.id === 'number' ? body.id : null

  if (id !== null) {
    // Update existing draft
    const existing = await db.select().from(mailDraft).where(eq(mailDraft.id, id)).limit(1)
    if (existing.length > 0) {
      await db
        .update(mailDraft)
        .set({
          toAddr: body.to ?? '',
          cc: body.cc ?? '',
          bcc: body.bcc ?? '',
          subject: body.subject ?? '',
          html: body.html ?? '',
          attachments: JSON.stringify(parsedAttachments.attachments),
          inReplyTo: body.inReplyTo ?? null,
          updatedAt: now
        })
        .where(eq(mailDraft.id, id))
      return json({ id, updatedAt: now.toISOString() })
    }
  }

  // Insert new draft
  const [inserted] = await db
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

  if (!inserted) return error(500, 'Failed to save draft')

  return json({ id: inserted.id, updatedAt: now.toISOString() })
}
