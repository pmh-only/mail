import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailFilter } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const ids = body.ids as number[]

  if (!Array.isArray(ids)) return error(400, 'ids must be an array')

  for (let i = 0; i < ids.length; i++) {
    await db.update(mailFilter).set({ sortOrder: i }).where(eq(mailFilter.id, ids[i]))
  }

  return json({ ok: true })
}
