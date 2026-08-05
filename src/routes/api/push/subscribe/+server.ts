import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailPushSubscription } from '$lib/server/db/schema'
import { count, eq, sql } from 'drizzle-orm'
import { isDemoModeEnabled } from '$lib/server/demo'
import { normalizeReadControlVersion } from '$lib/push-control'
import {
  MAX_PUSH_REQUEST_BYTES,
  MAX_PUSH_SUBSCRIPTIONS,
  validatePushSubscription
} from '$lib/server/push-endpoint'

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user || !locals.session) return error(401, 'Authentication required')
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_PUSH_REQUEST_BYTES) return error(413, 'Subscription is too large')
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody) > MAX_PUSH_REQUEST_BYTES)
    return error(413, 'Subscription is too large')
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return error(400, 'Invalid subscription JSON')
  }
  let subscription
  try {
    subscription = validatePushSubscription(body)
  } catch (cause) {
    return error(400, cause instanceof Error ? cause.message : 'Invalid subscription')
  }

  if (isDemoModeEnabled()) {
    return json({ ok: true, demo: true })
  }

  const normalizedReadControlVersion = normalizeReadControlVersion(body.readControlVersion)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mail_push_subscription_quota'))`)
    const [existing, total] = await Promise.all([
      tx
        .select({ id: mailPushSubscription.id })
        .from(mailPushSubscription)
        .where(eq(mailPushSubscription.endpoint, subscription.endpoint))
        .limit(1),
      tx.select({ count: count() }).from(mailPushSubscription)
    ])
    if (!existing[0] && Number(total[0]?.count ?? 0) >= MAX_PUSH_SUBSCRIPTIONS) {
      error(409, 'Push subscription limit reached')
    }
    await tx
      .insert(mailPushSubscription)
      .values({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        readControlVersion: normalizedReadControlVersion
      })
      .onConflictDoUpdate({
        target: mailPushSubscription.endpoint,
        set: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          readControlVersion: normalizedReadControlVersion
        }
      })
  })

  return json({ ok: true })
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.user || !locals.session) return error(401, 'Authentication required')
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
