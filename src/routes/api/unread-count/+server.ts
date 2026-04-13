import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessageMailbox } from '$lib/server/db/schema'
import { and, eq, notLike } from 'drizzle-orm'
import { getImapConfig } from '$lib/server/config'

export const GET: RequestHandler = async () => {
  const config = await getImapConfig()
  if ('missing' in config) return json({ count: 0 })

  const rows = await db
    .select({ flags: mailMessageMailbox.flags })
    .from(mailMessageMailbox)
    .where(
      and(
        eq(mailMessageMailbox.mailbox, config.mailbox),
        notLike(mailMessageMailbox.flags, '%\\\\Seen%')
      )
    )

  return json({ count: rows.length })
}
