import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailboxCatalog } from '$lib/server/db/schema'
import { setMailboxPreferences } from '$lib/server/preferences'

export const PATCH: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}))
  if (!body.preferences || typeof body.preferences !== 'object') {
    return error(400, 'preferences object is required')
  }

  try {
    // Fetch all currently configured mailbox paths from DB to validate against
    const mailboxes = await db.select({ path: mailboxCatalog.path }).from(mailboxCatalog)
    const validPaths = mailboxes.map((mb) => mb.path)

    setMailboxPreferences(cookies, body.preferences, validPaths)

    return json({ success: true, preferences: body.preferences })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return error(500, `Failed to update mailbox preferences: ${message}`)
  }
}
