import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { currentRostackCursor, listRostackEvents, RostackError } from '$lib/server/rostack'

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const cursor = url.searchParams.get('cursor')
    const events = cursor ? await listRostackEvents(cursor, locals.rostackPrincipalId!) : []
    return json({
      events,
      cursor: cursor ?? (await currentRostackCursor(locals.rostackPrincipalId!))
    })
  } catch (error) {
    if (error instanceof RostackError)
      return json({ code: error.code, message: error.message }, { status: error.status })
    throw error
  }
}
