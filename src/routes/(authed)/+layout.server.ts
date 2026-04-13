import type { LayoutServerLoad } from './$types'
import { listImapMailboxes } from '$lib/server/mail'

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    imapMailboxes: listImapMailboxes(),
    user: locals.user ?? null
  }
}
