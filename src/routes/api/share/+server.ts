import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { createShareToken, createThreadShareToken, revokeShareToken } from '$lib/server/mail'

export const POST: RequestHandler = async ({ request, url }) => {
  const body = await request.json().catch(() => null)
  const id = body?.id
  const messageIds = body?.messageIds

  let token: string | null = null

  if (Array.isArray(messageIds) && messageIds.length > 0) {
    const validIds = messageIds.filter((m): m is string => typeof m === 'string' && m.length > 0)
    if (validIds.length === 0) {
      error(400, 'Invalid messageIds array')
    }
    token = await createThreadShareToken(validIds)
  } else if (id && typeof id === 'number') {
    token = await createShareToken(id)
  } else {
    error(400, 'Missing message id or messageIds')
  }

  if (!token) error(404, 'Message or thread not found')

  const shareUrl = `${url.origin}/share/${token}`
  return json({ url: shareUrl, token })
}

export const DELETE: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  if (typeof body?.token !== 'string' || !body.token) error(400, 'Missing share token')
  if (!(await revokeShareToken(body.token))) error(404, 'Share token not found')
  return json({ ok: true })
}
