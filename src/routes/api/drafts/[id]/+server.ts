import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailDraft } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'

export const DELETE: RequestHandler = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return error(400, 'Invalid draft ID')

  await db.delete(mailDraft).where(eq(mailDraft.id, id))
  return json({ ok: true })
}
