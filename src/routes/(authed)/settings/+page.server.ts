import type { PageServerLoad } from './$types'
import { getDisplayConfig } from '$lib/server/config'
import { getStoredPreferences } from '$lib/server/preferences'
import { env } from '$lib/server/env-private'
import { getImapMailboxes } from '$lib/server/mail'
import { getLoginMethods } from '$lib/server/auth-methods'
import { isDemoModeEnabled } from '$lib/server/demo'
import { listComposedMailboxes } from '$lib/server/composed-mailboxes'

export const load: PageServerLoad = async () => {
  const config = await getDisplayConfig()
  const [imapMailboxes, loginMethods, preferences, composedMailboxes] = await Promise.all([
    getImapMailboxes(),
    getLoginMethods(),
    getStoredPreferences(),
    isDemoModeEnabled() ? Promise.resolve([]) : listComposedMailboxes()
  ])
  return {
    config,
    demoMode: isDemoModeEnabled(),
    loginMethods,
    imapMailboxes,
    composedMailboxes,
    origin: env.ORIGIN ?? '',
    ...preferences,
    compactMode: preferences.density !== 'comfortable'
  }
}
