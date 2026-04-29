import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailPushSubscription } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { isDemoModeEnabled } from '$lib/server/demo'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const { endpoint, keys } = body as {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return error(400, 'Invalid subscription')
  }

  if (isDemoModeEnabled()) {
    return json({ ok: true, demo: true })
  }

  await db
    .insert(mailPushSubscription)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: mailPushSubscription.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth }
    })

  return json({ ok: true })
}

export const DELETE: RequestHandler = async ({ request }) => {
  const body = await request.json()
  const { endpoint } = body as { endpoint: string }

  if (isDemoModeEnabled()) {
    return json({ ok: true, demo: true })
  }

  if (endpoint) {
    await db.delete(mailPushSubscription).where(eq(mailPushSubscription.endpoint, endpoint))
  }

  return json({ ok: true })
}
