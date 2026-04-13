import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailDraft } from '$lib/server/db/schema'
import { parseComposerAttachments } from '$lib/mail-attachments'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return error(400, 'Invalid draft ID')

  const [draft] = await db.select().from(mailDraft).where(eq(mailDraft.id, id)).limit(1)
  if (!draft) return error(404, 'Draft not found')

  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(draft.attachments)
  } catch {
    return error(500, 'Stored draft attachments are invalid')
  }

  const parsedAttachments = parseComposerAttachments(parsedRaw)
  if (!parsedAttachments.ok) {
    return error(500, parsedAttachments.error)
  }

  return json({
    draft: {
      id: draft.id,
      toAddr: draft.toAddr,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      html: draft.html,
      attachments: parsedAttachments.attachments,
      inReplyTo: draft.inReplyTo,
      updatedAt: draft.updatedAt?.toISOString() ?? new Date().toISOString()
    }
  })
}

export const DELETE: RequestHandler = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return error(400, 'Invalid draft ID')

  await db.delete(mailDraft).where(eq(mailDraft.id, id))
  return json({ ok: true })
}
