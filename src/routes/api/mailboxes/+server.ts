import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessageMailbox } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { notLike, sql } from 'drizzle-orm'

export const GET: RequestHandler = async () => {
  const startedAt = perfNow()
  const [mailboxes, unreadRows] = await Promise.all([
    getImapMailboxes(),
    db
      .select({
        mailbox: mailMessageMailbox.mailbox,
        count: sql<number>`count(*)`
      })
      .from(mailMessageMailbox)
      .where(notLike(mailMessageMailbox.flags, '%\\\\Seen%'))
      .groupBy(mailMessageMailbox.mailbox)
  ])
  const unreadCounts = Object.fromEntries(
    unreadRows.map((row) => [row.mailbox, Number(row.count ?? 0)])
  ) as Record<string, number>
  const body = { mailboxes, unreadCounts }

  perfLog('api.mailboxes.GET', {
    rows: mailboxes.length,
    unreadRows: unreadRows.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return json(body)
}
