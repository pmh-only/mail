import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailMessage, mailMessageMailbox } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { isAlwaysReadMailbox } from '$lib/mailbox'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { eq, notLike, sql } from 'drizzle-orm'
import { getDemoUnreadCounts, isDemoModeEnabled } from '$lib/server/demo'
import { applyMailboxPreferences, getStoredPreferences } from '$lib/server/preferences'
import {
  getComposedMailboxUnreadCounts,
  listComposedMailboxes
} from '$lib/server/composed-mailboxes'

export const GET: RequestHandler = async () => {
  const startedAt = perfNow()
  const { mailboxPreferences } = await getStoredPreferences()

  if (isDemoModeEnabled()) {
    const mailboxes = applyMailboxPreferences(await getImapMailboxes(), mailboxPreferences)
    const unreadCounts = getDemoUnreadCounts()
    const body = { mailboxes, unreadCounts }

    perfLog('api.mailboxes.GET', {
      rows: mailboxes.length,
      unreadRows: Object.keys(unreadCounts).length,
      payloadBytes: payloadBytes(body),
      ms: perfMs(startedAt)
    })

    return json(body)
  }

  const [mailboxes, unreadRows, composedMailboxes] = await Promise.all([
    getImapMailboxes(),
    db
      .select({
        mailbox: mailMessageMailbox.mailbox,
        count: sql<number>`count(distinct ${mailMessage.threadKey})`
      })
      .from(mailMessageMailbox)
      .innerJoin(mailMessage, eq(mailMessageMailbox.mailMessageId, mailMessage.id))
      .where(notLike(mailMessageMailbox.flags, '%\\\\Seen%'))
      .groupBy(mailMessageMailbox.mailbox),
    listComposedMailboxes()
  ])
  const unreadCounts = Object.fromEntries(
    unreadRows
      .filter((row) => !isAlwaysReadMailbox(row.mailbox))
      .map((row) => [row.mailbox, Number(row.count ?? 0)])
  ) as Record<string, number>
  Object.assign(unreadCounts, await getComposedMailboxUnreadCounts(composedMailboxes))
  const body = {
    mailboxes: applyMailboxPreferences(mailboxes, mailboxPreferences),
    composedMailboxes,
    unreadCounts
  }

  perfLog('api.mailboxes.GET', {
    rows: mailboxes.length,
    unreadRows: unreadRows.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return json(body)
}
