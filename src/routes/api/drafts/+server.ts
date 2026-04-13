import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailDraft } from '$lib/server/db/schema'
import { desc, eq } from 'drizzle-orm'

export const GET: RequestHandler = async () => {
  const drafts = await db
    .select()
    .from(mailDraft)
    .orderBy(desc(mailDraft.updatedAt))

  return json({
    drafts: drafts.map((d) => ({
      id: d.id,
      toAddr: d.toAddr,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      html: d.html,
      inReplyTo: d.inReplyTo,
      updatedAt: d.updatedAt?.toISOString() ?? new Date().toISOString()
    }))
  })
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const now = new Date()

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
      inReplyTo: body.inReplyTo ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: mailDraft.id })

  if (!inserted) return error(500, 'Failed to save draft')

  return json({ id: inserted.id, updatedAt: now.toISOString() })
}
