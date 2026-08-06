import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { getStoredPreferences } from '$lib/server/preferences'
import { pathToSlug } from '$lib/mailbox'

export const load: PageServerLoad = async ({ parent }) => {
  const [{ imapMailboxes, composedMailboxes }, preferences] = await Promise.all([
    parent(),
    getStoredPreferences()
  ])
  const validSlugs = new Set([
    ...imapMailboxes.map((mailbox) => pathToSlug(mailbox.path)),
    ...composedMailboxes.map((mailbox) => mailbox.slug)
  ])
  const target = validSlugs.has(preferences.defaultMailbox) ? preferences.defaultMailbox : 'inbox'
  redirect(302, `/${target}`)
}
