import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getVapidPublicKey } from '$lib/server/push'
import { getDemoVapidPublicKey, isDemoModeEnabled } from '$lib/server/demo'

export const GET: RequestHandler = async () => {
  if (isDemoModeEnabled()) {
    return json({ publicKey: getDemoVapidPublicKey() })
  }
  const publicKey = await getVapidPublicKey()
  return json({ publicKey })
}
