import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import nodemailer from 'nodemailer'
import { getSmtpConfig } from '$lib/server/config'
import { logServerError } from '$lib/server/perf'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}))

  const saved = await getSmtpConfig()
  const smtp = body.smtp as Record<string, unknown> | undefined

  const host = (smtp?.host as string | undefined)?.trim() || ('host' in saved ? saved.host : '')
  const port =
    (typeof smtp?.port === 'number' ? smtp.port : null) ?? ('port' in saved ? saved.port : 587)
  const secure =
    (typeof smtp?.secure === 'boolean' ? smtp.secure : null) ??
    ('secure' in saved ? saved.secure : false)
  const user = (smtp?.user as string | undefined)?.trim() || ('user' in saved ? saved.user : '')
  const rawPassword = smtp?.password as string | undefined
  const password =
    rawPassword && rawPassword !== '••••••••'
      ? rawPassword
      : 'password' in saved && !('missing' in saved)
        ? saved.password
        : ''

  if (!host || !user || !password) {
    return json({ ok: false, message: 'Host, user, and password are required.' }, { status: 400 })
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Boolean(secure),
    auth: { user, pass: password }
  })

  try {
    await transporter.verify()
    return json({ ok: true, message: 'Connected successfully.' })
  } catch (err) {
    logServerError('api.settings.testSmtp.POST.verify', err, {
      host,
      port: Number(port),
      secure: Boolean(secure)
    })
    const message = err instanceof Error ? err.message : String(err)
    return json({ ok: false, message }, { status: 400 })
  }
}
