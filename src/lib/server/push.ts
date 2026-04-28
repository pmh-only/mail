import webpush from 'web-push'
import { db } from './db'
import { mailConfig, mailPushSubscription } from './db/schema'
import { logServerError } from './perf'
import { eq } from 'drizzle-orm'

let initialized = false

async function ensureInit(): Promise<boolean> {
  if (initialized) return true

  const [config] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  if (!config?.vapidPublicKey || !config?.vapidPrivateKey || !config?.vapidSubject) return false

  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)
  initialized = true
  return true
}

// Call after saving new VAPID keys so they take effect immediately
export function resetPushInit() {
  initialized = false
}

export async function getVapidPublicKey(): Promise<string | null> {
  const [config] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  return config?.vapidPublicKey ?? null
}

export async function sendPushToAll(payload: {
  title: string
  body: string
  url?: string
}): Promise<void> {
  const ready = await ensureInit()
  if (!ready) return

  const subscriptions = await db.select().from(mailPushSubscription)
  if (subscriptions.length === 0) return

  const data = JSON.stringify(payload)

  await Promise.allSettled(
    subscriptions.map(async (sub: typeof subscriptions[number]) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data
        )
      } catch (err: unknown) {
        // 404/410 means the subscription is gone — remove it
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) {
          await db
            .delete(mailPushSubscription)
            .where(eq(mailPushSubscription.endpoint, sub.endpoint))
          return
        }

        logServerError('push.sendNotification', err, {
          endpoint: sub.endpoint,
          status: status ?? null
        })
      }
    })
  )
}
