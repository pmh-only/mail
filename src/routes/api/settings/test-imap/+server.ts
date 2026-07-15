import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getImapConfig } from '$lib/server/config'
import { isDemoModeEnabled } from '$lib/server/demo'
import { ImapFlow } from 'imapflow'
import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '$lib/server/secrets'

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
  let password = ''
  if (rawPassword && rawPassword !== '••••••••') {
    password = rawPassword
  } else {
    if (saved && 'password' in saved && !('missing' in saved) && user === saved.user && host === saved.host) {
      password = saved.password
    } else {
      const [config] = await db.select({ imapServers: mailConfig.imapServers }).from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
      if (config?.imapServers && Array.isArray(config.imapServers)) {
        const matched = config.imapServers.find(
          (s: any) => s && s.user === user && s.host === host
        )
        if (matched && matched.password) {
          try {
            password = decryptSecret(matched.password)
          } catch (e) {
            console.error('[test-imap] Decryption failed:', e)
          }
        }
      }
    }
  }

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
