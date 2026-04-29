import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessageMailbox } from '$lib/server/db/schema'
import { and, eq, notLike, sql } from 'drizzle-orm'
import { getImapConfig } from '$lib/server/config'
import { perfLog, perfMs, perfNow } from '$lib/server/perf'
import { getDemoUnreadCount, isDemoModeEnabled } from '$lib/server/demo'

export const GET: RequestHandler = async () => {
  const startedAt = perfNow()
  if (isDemoModeEnabled()) {
    const count = getDemoUnreadCount()
    perfLog('api.unreadCount.GET', { configured: true, count, ms: perfMs(startedAt), demo: true })
    return json({ count })
  }

  const config = await getImapConfig()
  if ('missing' in config) {
    perfLog('api.unreadCount.GET', {
      configured: false,
      count: 0,
      ms: perfMs(startedAt)
    })
    return json({ count: 0 })
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(mailMessageMailbox)
    .where(
      and(
        eq(mailMessageMailbox.mailbox, config.mailbox),
        notLike(mailMessageMailbox.flags, '%\\\\Seen%')
      )
    )

  const count = Number(row?.count ?? 0)

  perfLog('api.unreadCount.GET', {
    configured: true,
    mailbox: config.mailbox,
    count,
    ms: perfMs(startedAt)
  })

  return json({ count })
}
