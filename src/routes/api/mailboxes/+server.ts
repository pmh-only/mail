import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getImapMailboxes } from '$lib/server/mail'
import { payloadBytes, perfLog, perfMs, perfNow } from '$lib/server/perf'

export const GET: RequestHandler = async () => {
  const startedAt = perfNow()
  const mailboxes = await getImapMailboxes()
  const body = { mailboxes }

  perfLog('api.mailboxes.GET', {
    rows: mailboxes.length,
    payloadBytes: payloadBytes(body),
    ms: perfMs(startedAt)
  })

  return json(body)
}
