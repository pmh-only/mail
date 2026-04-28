import type { LayoutServerLoad } from './$types'
import { getMailboxSyncStatus, resolveMailboxPath } from '$lib/server/mail'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'
import { getCompactModeEnabled, getSimplifiedViewEnabled } from '$lib/server/preferences'

export const load: LayoutServerLoad = async ({ params, parent, cookies }) => {
  const startedAt = perfNow()
  const { imapMailboxes } = await parent()
  const mailboxPath = await resolveMailboxPath(params.mailbox, imapMailboxes)

  const sync = await getMailboxSyncStatus(mailboxPath)

  const body = {
    sync,
    simplifiedView: getSimplifiedViewEnabled(cookies),
    compactMode: getCompactModeEnabled(cookies)
  }

  perfLog('load.mailboxLayout', {
    mailbox: mailboxPath,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return body
}
