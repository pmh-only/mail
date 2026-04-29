import type { LayoutServerLoad } from './$types'
import { db } from '$lib/server/db'
import { mailMessageMailbox } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { getSimplifiedViewEnabled, getTranslationTargetLanguage } from '$lib/server/preferences'
import { notLike, sql } from 'drizzle-orm'
import { getDemoUnreadCounts, isDemoModeEnabled } from '$lib/server/demo'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  if (isDemoModeEnabled()) {
    return {
      imapMailboxes: await getImapMailboxes(),
      unreadCounts: getDemoUnreadCounts(),
      user: locals.user ?? null,
      simplifiedView: getSimplifiedViewEnabled(cookies),
      translationTargetLanguage: getTranslationTargetLanguage(cookies)
    }
  }

  const [imapMailboxes, unreadRows] = await Promise.all([
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

  return {
    imapMailboxes,
    unreadCounts: Object.fromEntries(
      unreadRows.map((row) => [row.mailbox, Number(row.count ?? 0)])
    ) as Record<string, number>,
    user: locals.user ?? null,
    simplifiedView: getSimplifiedViewEnabled(cookies),
    translationTargetLanguage: getTranslationTargetLanguage(cookies)
  }
}
