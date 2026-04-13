import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import webpush from 'web-push'
import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { resetPushInit } from '$lib/server/push'

export const POST: RequestHandler = async ({ url }) => {
  const vapidKeys = webpush.generateVAPIDKeys()
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

  return json({ publicKey: vapidKeys.publicKey, subject })
}
