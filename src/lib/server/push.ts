import webpush from 'web-push'
import { db } from './db'
import { mailConfig, mailPushSubscription } from './db/schema'
import { logServerError } from './perf'
import { eq } from 'drizzle-orm'
import { getQuietHoursConfig } from './config'
import { isQuietHoursActive } from './quiet-hours'
import { readControlSubscriptions, readNotificationBatches } from '$lib/push-control'
import { pushDeliveryComplete, type PushDeliveryResult } from '$lib/push-delivery'
import { sendWebPushSafely, validatePushSubscription } from './push-endpoint'

const PUSH_TTL_SECONDS = 24 * 60 * 60
const CONTROL_PUSH_ATTEMPTS = 3

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

type NewMailPush = {
  title: string
  body: string
  url?: string
  tag?: string
  messageId?: number
  unreadCount?: number
}

type PushPayload = NewMailPush | { type: 'messages-read'; messageIds: number[] }

async function sendPushPayload(payload: PushPayload): Promise<boolean> {
  const ready = await ensureInit()
  if (!ready) return false

  const allSubscriptions = await db.select().from(mailPushSubscription)
  const subscriptions =
    'type' in payload ? readControlSubscriptions(allSubscriptions) : allSubscriptions
  if (subscriptions.length === 0) return false

  const data = JSON.stringify(payload)
  const maxAttempts = 'type' in payload ? CONTROL_PUSH_ATTEMPTS : 1

  const results: PushDeliveryResult[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(4, subscriptions.length) }, async () => {
    while (nextIndex < subscriptions.length) {
      const sub = subscriptions[nextIndex++]
      let result: PushDeliveryResult = 'retryable'
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const subscription = validatePushSubscription({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          })
          await sendWebPushSafely(subscription, data, PUSH_TTL_SECONDS)
          result = 'delivered'
          break
        } catch (err: unknown) {
          // 404/410 means the subscription is gone — remove it
          const status = (err as { statusCode?: number })?.statusCode
          if (status === 404 || status === 410) {
            await db
              .delete(mailPushSubscription)
              .where(eq(mailPushSubscription.endpoint, sub.endpoint))
            result = 'terminal'
            break
          }

          const retryable =
            status === undefined || status === 408 || status === 429 || status >= 500
          if (attempt < maxAttempts && retryable) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
            continue
          }

          logServerError('push.sendNotification', err, {
            endpointOrigin: new URL(sub.endpoint).origin,
            status: status ?? null,
            attempts: attempt
          })
          result = retryable ? 'retryable' : 'terminal'
          break
        }
      }
      results.push(result)
    }
  })
  await Promise.all(workers)
  return pushDeliveryComplete(results)
}

export async function sendPushToAll(payload: NewMailPush): Promise<boolean> {
  if (isQuietHoursActive(await getQuietHoursConfig())) return false
  return sendPushPayload(payload)
}

export async function dismissReadNotifications(messageIds: number[]): Promise<void> {
  for (const batch of readNotificationBatches(messageIds)) {
    await sendPushPayload({ type: 'messages-read', messageIds: batch })
  }
}
