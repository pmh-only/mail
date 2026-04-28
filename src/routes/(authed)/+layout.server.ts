import type { LayoutServerLoad } from './$types'
import { getImapMailboxes } from '$lib/server/mail'
import { getSimplifiedViewEnabled } from '$lib/server/preferences'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  return {
    imapMailboxes: await getImapMailboxes(),
    user: locals.user ?? null,
    simplifiedView: getSimplifiedViewEnabled(cookies)
  }
}
