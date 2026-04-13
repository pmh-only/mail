import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getVapidPublicKey } from '$lib/server/push'

export const GET: RequestHandler = async () => {
  const publicKey = await getVapidPublicKey()
  return json({ publicKey })
}
