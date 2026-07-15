import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getImapConfig } from '$lib/server/config'
import { isDemoModeEnabled } from '$lib/server/demo'
import { ImapFlow } from 'imapflow'

export const POST: RequestHandler = async ({ request }) => {
  if (isDemoModeEnabled()) {
    await request.json().catch(() => null)
    return json({ ok: true, message: 'Demo mode: IMAP connection simulated successfully.' })
  }

  const body = await request.json().catch(() => ({}))

  // Use submitted form values merged over saved/env config
  const saved = await getImapConfig()
  const imap = body.imap as Record<string, unknown> | undefined

  const host = (imap?.host as string | undefined)?.trim() || ('host' in saved ? saved.host : '')
  const port =
    (typeof imap?.port === 'number' ? imap.port : null) ?? ('port' in saved ? saved.port : 993)
  const secure =
    (typeof imap?.secure === 'boolean' ? imap.secure : null) ??
    ('secure' in saved ? saved.secure : true)
  const user = (imap?.user as string | undefined)?.trim() || ('user' in saved ? saved.user : '')
  // Accept new password if provided; fall back to saved (non-masked)
  const rawPassword = imap?.password as string | undefined
  const password =
    rawPassword && rawPassword !== '••••••••'
      ? rawPassword
      : 'password' in saved && !('missing' in saved)
        ? saved.password
        : ''

  if (!host || !user || !password) {
    return json({ ok: false, message: 'Host, user, and password are required.' }, { status: 400 })
  }

  try {
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: {
        user,
        pass: password
      },
      logger: false,
      connectionTimeout: 8000
    })
    await client.connect()
    await client.logout()

    return json({
      ok: true,
      message: `Connected successfully to IMAP server ${host}:${Number(port)}.`
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return json({
      ok: false,
      message: `IMAP connection failed: ${msg}`
    }, { status: 500 })
  }
}
