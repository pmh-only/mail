import type { LayoutServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { mailApiKey, mailMessage, mailMessageMailbox, savedSearch } from '$lib/server/db/schema'
import { getImapMailboxes } from '$lib/server/mail'
import { isAlwaysReadMailbox } from '$lib/mailbox'
import { applyMailboxPreferences, getStoredPreferences } from '$lib/server/preferences'
import { and, asc, eq, notLike, sql } from 'drizzle-orm'
import { getDemoUnreadCounts, isDemoModeEnabled } from '$lib/server/demo'
import { getImapConfigs, getOpenAIConfig } from '$lib/server/config'
import {
  getComposedMailboxUnreadCounts,
  listComposedMailboxes
} from '$lib/server/composed-mailboxes'

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login')
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
      hasOpenAiKey: true,
      hasLegacyApiKey: false
    }
  }

  const [
    openaiConfig,
    imapConfigs,
    [imapMailboxes, unreadRows, savedSearchRows, composedMailboxes],
    legacyApiKeyRows
  ] = await Promise.all([
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
        .innerJoin(mailMessage, eq(mailMessageMailbox.mailMessageId, mailMessage.id))
        .where(notLike(mailMessageMailbox.flags, '%\\\\Seen%'))
        .groupBy(mailMessageMailbox.mailbox),
      db.select().from(savedSearch).orderBy(asc(savedSearch.name)),
      listComposedMailboxes()
    ]),
    db
      .select({ id: mailApiKey.id })
      .from(mailApiKey)
      .where(and(eq(mailApiKey.userId, locals.user.id), notLike(mailApiKey.keyHash, 'scrypt$%')))
      .limit(1)
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
    hasOpenAiKey: Boolean(openaiConfig.apiKey),
    hasLegacyApiKey: legacyApiKeyRows.length > 0
  }
}
