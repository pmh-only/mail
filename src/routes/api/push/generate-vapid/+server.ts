import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { generateVAPIDKeys } from 'web-push'
import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { resetPushInit } from '$lib/server/push'
import { generateDemoVapidKeys, isDemoModeEnabled } from '$lib/server/demo'
import { writeAuditLog } from '$lib/server/audit-log'

export const POST: RequestHandler = async (event) => {
  const { url } = event
  if (isDemoModeEnabled()) {
    return json(generateDemoVapidKeys())
  }

  const vapidKeys = generateVAPIDKeys()
  const subject = url.origin

  await db
    .insert(mailConfig)
    .values({
      id: 1,
      vapidPublicKey: vapidKeys.publicKey,
      vapidPrivateKey: vapidKeys.privateKey,
      vapidSubject: `mailto:admin@${new URL(url.origin).hostname}`
    })
    .onConflictDoUpdate({
      target: mailConfig.id,
      set: {
        vapidPublicKey: vapidKeys.publicKey,
        vapidPrivateKey: vapidKeys.privateKey,
        vapidSubject: `mailto:admin@${new URL(url.origin).hostname}`
      }
    })

  resetPushInit()

  await writeAuditLog({
    action: 'security.vapid.generate',
    entityType: 'security',
    summary: 'Generated VAPID keys',
    metadata: { publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey, subject },
    event
  })

  return json({ publicKey: vapidKeys.publicKey, subject })
}
