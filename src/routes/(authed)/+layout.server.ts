import type { LayoutServerLoad } from './$types'
import { db } from '$lib/server/db'
import { mailMessage, mailMessageMailbox, savedSearch } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { isAlwaysReadMailbox } from '$lib/mailbox'
import { applyMailboxPreferences, getStoredPreferences } from '$lib/server/preferences'
import { asc, eq, notLike, sql } from 'drizzle-orm'
import { getDemoUnreadCounts, isDemoModeEnabled } from '$lib/server/demo'
import { getImapConfigs, getOpenAIConfig } from '$lib/server/config'
import {
  getComposedMailboxUnreadCounts,
  listComposedMailboxes
} from '$lib/server/composed-mailboxes'

export const load: LayoutServerLoad = async ({ locals }) => {
  const preferences = await getStoredPreferences()
  const { mailboxPreferences } = preferences

  if (isDemoModeEnabled()) {
    const imapMailboxes = await getImapMailboxes()
    return {
      imapMailboxes: applyMailboxPreferences(imapMailboxes, mailboxPreferences),
      composedMailboxes: [],
      mailboxPreferences,
      secondaryNames: [],
      unreadCounts: getDemoUnreadCounts(),
      user: locals.user ?? null,
      simplifiedView: preferences.simplifiedView,
      translationTargetLanguage: preferences.translationTargetLanguage,
      sidebarWidth: preferences.sidebarWidth,
      savedSearches: [],
      hasOpenAiKey: true
    }
  }

  const [openaiConfig, imapConfigs, [imapMailboxes, unreadRows, savedSearchRows, composedMailboxes]] =
    await Promise.all([
      getOpenAIConfig(),
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
        db.select().from(savedSearch).orderBy(asc(savedSearch.name)),
        listComposedMailboxes()
      ])
    ])

  const secondaryNames = imapConfigs
    .filter((s) => s.id !== 'primary')
    .map((s) => s.name)
    .filter(Boolean)
  const composedUnreadCounts = await getComposedMailboxUnreadCounts(composedMailboxes)

  return {
    imapMailboxes: applyMailboxPreferences(imapMailboxes, mailboxPreferences),
    composedMailboxes,
    mailboxPreferences,
    secondaryNames,
    unreadCounts: {
      ...Object.fromEntries(
        unreadRows
          .filter((row) => !isAlwaysReadMailbox(row.mailbox))
          .map((row) => [row.mailbox, Number(row.count ?? 0)])
      ),
      ...composedUnreadCounts
    } as Record<string, number>,
    user: locals.user ?? null,
    simplifiedView: preferences.simplifiedView,
    translationTargetLanguage: preferences.translationTargetLanguage,
    sidebarWidth: preferences.sidebarWidth,
    savedSearches: savedSearchRows,
    hasOpenAiKey: Boolean(openaiConfig.apiKey)
  }
}
