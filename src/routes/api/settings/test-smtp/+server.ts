import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getSmtpConfig } from '$lib/server/config'
import { isDemoModeEnabled } from '$lib/server/demo'
import nodemailer from 'nodemailer'

export const POST: RequestHandler = async ({ request }) => {
  if (isDemoModeEnabled()) {
    await request.json().catch(() => null)
    return json({ ok: true, message: 'Demo mode: SMTP connection simulated successfully.' })
  }

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

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass: password
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000
    })
    await transporter.verify()

    return json({
      ok: true,
      message: `Connected successfully to SMTP server ${host}:${Number(port)}.`
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return json({
      ok: false,
      message: `SMTP connection failed: ${msg}`
    }, { status: 500 })
  }
}
