import type { LayoutServerLoad } from './$types'
import { db } from '$lib/server/db'
import { mailConfig, mailMessage, mailMessageMailbox, savedSearch } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { isAlwaysReadMailbox } from '$lib/mailbox'
import {
  applyMailboxPreferences,
  getMailboxPreferences,
  getSimplifiedViewEnabled,
  getTranslationTargetLanguage
} from '$lib/server/preferences'
import { asc, eq, notLike, sql } from 'drizzle-orm'
import { getDemoUnreadCounts, isDemoModeEnabled } from '$lib/server/demo'
import { getImapConfigs } from '$lib/server/config'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const mailboxPreferences = getMailboxPreferences(cookies)

  if (isDemoModeEnabled()) {
    const imapMailboxes = await getImapMailboxes()
    return {
      imapMailboxes: applyMailboxPreferences(imapMailboxes, mailboxPreferences),
      mailboxPreferences,
      secondaryNames: [],
      unreadCounts: getDemoUnreadCounts(),
      user: locals.user ?? null,
      simplifiedView: getSimplifiedViewEnabled(cookies),
      translationTargetLanguage: getTranslationTargetLanguage(cookies),
      savedSearches: []
    }
  }

  const [imapConfigs, [imapMailboxes, unreadRows, savedSearchRows]] = await Promise.all([
    getImapConfigs(),
    Promise.all([
      getImapMailboxes(),
      db
        .select({
          mailbox: mailMessageMailbox.mailbox,
          count: sql<number>`count(distinct ${mailMessage.threadKey})`
        })
        .from(mailMessageMailbox)
        .innerJoin(mailMessage, eq(mailMessageMailbox.messageId, mailMessage.messageId))
        .where(notLike(mailMessageMailbox.flags, '%\\\\Seen%'))
        .groupBy(mailMessageMailbox.mailbox),
      db.select().from(savedSearch).orderBy(asc(savedSearch.name))
    ])
  ])

  const secondaryNames = imapConfigs
    .filter((s) => s.id !== 'primary')
    .map((s) => s.name)
    .filter(Boolean)

  return {
    imapMailboxes: applyMailboxPreferences(imapMailboxes, mailboxPreferences),
    mailboxPreferences,
    secondaryNames,
    unreadCounts: Object.fromEntries(
      unreadRows
        .filter((row) => !isAlwaysReadMailbox(row.mailbox))
        .map((row) => [row.mailbox, Number(row.count ?? 0)])
    ) as Record<string, number>,
    user: locals.user ?? null,
    simplifiedView: getSimplifiedViewEnabled(cookies),
    translationTargetLanguage: getTranslationTargetLanguage(cookies),
    savedSearches: savedSearchRows
  }
}
