import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { getDisplayConfig, invalidateConfigCache } from '$lib/server/config'
import { invalidateAuth } from '$lib/server/auth'
import { startMailboxSync } from '$lib/server/mail'
import { getSimplifiedViewEnabled, setSimplifiedViewEnabled } from '$lib/server/preferences'
// Note: signature cache invalidation is client-side only (composer.svelte.ts)

export const GET: RequestHandler = async ({ cookies }) => {
  const config = await getDisplayConfig()
  return json({
    ...config,
    simplifiedView: getSimplifiedViewEnabled(cookies)
  })
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json()

  const values: typeof mailConfig.$inferInsert = {
    id: 1,
    updatedAt: new Date()
  }

  // IMAP fields — only persist non-empty strings, keep null for "use env var"
  if (body.imap) {
    const imap = body.imap as Record<string, unknown>
    if (typeof imap.host === 'string') values.imapHost = imap.host.trim() || null
    if (typeof imap.port === 'number') values.imapPort = imap.port > 0 ? imap.port : null
    if (typeof imap.secure === 'boolean') values.imapSecure = imap.secure
    if (typeof imap.user === 'string') values.imapUser = imap.user.trim() || null
    // Empty password means "leave existing / use env" — don't overwrite with empty
    if (typeof imap.password === 'string' && imap.password.trim() && imap.password !== '••••••••') {
      values.imapPassword = imap.password
    }
    if (typeof imap.mailbox === 'string') values.imapMailbox = imap.mailbox.trim() || null
    if (typeof imap.pollSeconds === 'number')
      values.imapPollSeconds = imap.pollSeconds > 0 ? imap.pollSeconds : null
  }

  // SMTP fields
  if (body.smtp) {
    const smtp = body.smtp as Record<string, unknown>
    if (typeof smtp.host === 'string') values.smtpHost = smtp.host.trim() || null
    if (typeof smtp.port === 'number') values.smtpPort = smtp.port > 0 ? smtp.port : null
    if (typeof smtp.secure === 'boolean') values.smtpSecure = smtp.secure
    if (typeof smtp.user === 'string') values.smtpUser = smtp.user.trim() || null
    if (typeof smtp.password === 'string' && smtp.password.trim() && smtp.password !== '••••••••') {
      values.smtpPassword = smtp.password
    }
    if (typeof smtp.from === 'string') values.smtpFrom = smtp.from.trim() || null
  }

  // Signature
  if (typeof body.signature === 'string') {
    values.signature = body.signature
  }

  // OIDC fields
  if (body.oidc) {
    const oidc = body.oidc as Record<string, unknown>
    if (typeof oidc.discoveryUrl === 'string')
      values.oidcDiscoveryUrl = oidc.discoveryUrl.trim() || null
    if (typeof oidc.clientId === 'string') values.oidcClientId = oidc.clientId.trim() || null
    if (
      typeof oidc.clientSecret === 'string' &&
      oidc.clientSecret.trim() &&
      oidc.clientSecret !== '••••••••'
    ) {
      values.oidcClientSecret = oidc.clientSecret
    }
  }

  try {
    await db.insert(mailConfig).values(values).onConflictDoUpdate({
      target: mailConfig.id,
      set: values
    })

    if (typeof body.simplifiedView === 'boolean') {
      setSimplifiedViewEnabled(cookies, body.simplifiedView)
    }

    invalidateConfigCache()
    invalidateAuth()
    void startMailboxSync()
    return json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return error(500, `Failed to save settings: ${message}`)
  }
}
