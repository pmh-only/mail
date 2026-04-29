import type { Actions, PageServerLoad } from './$types'
import { redirect, fail } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { invalidateConfigCache, isOidcConfigured } from '$lib/server/config'
import { invalidateAuth } from '$lib/server/auth'
import { env } from '$env/dynamic/private'
import { isDemoModeEnabled } from '$lib/server/demo'

export const load: PageServerLoad = async () => {
  if (isDemoModeEnabled()) {
    redirect(302, '/')
  }
  if (await isOidcConfigured()) {
    redirect(302, '/')
  }
  return { origin: env.ORIGIN ?? '' }
}

export const actions: Actions = {
  default: async ({ request }) => {
    if (isDemoModeEnabled()) {
      redirect(302, '/')
    }
    const form = await request.formData()

    const discoveryUrl = (form.get('discoveryUrl') as string)?.trim()
    const clientId = (form.get('clientId') as string)?.trim()
    const clientSecret = (form.get('clientSecret') as string)?.trim()

    if (!discoveryUrl || !clientId || !clientSecret) {
      return fail(400, { error: 'Discovery URL, Client ID and Client Secret are required.' })
    }

    const values: typeof mailConfig.$inferInsert = {
      id: 1,
      oidcDiscoveryUrl: discoveryUrl,
      oidcClientId: clientId,
      oidcClientSecret: clientSecret,
      updatedAt: new Date()
    }

    // IMAP — optional at setup time
    const imapHost = (form.get('imapHost') as string)?.trim()
    const imapPort = Number(form.get('imapPort'))
    const imapUser = (form.get('imapUser') as string)?.trim()
    const imapPassword = (form.get('imapPassword') as string)?.trim()
    const imapMailbox = (form.get('imapMailbox') as string)?.trim()
    const imapPollSeconds = Number(form.get('imapPollSeconds'))
    const imapSecure = form.get('imapSecure') === 'true'

    if (imapHost) values.imapHost = imapHost
    if (imapPort > 0) values.imapPort = imapPort
    if (imapUser) values.imapUser = imapUser
    if (imapPassword) values.imapPassword = imapPassword
    if (imapMailbox) values.imapMailbox = imapMailbox
    if (imapPollSeconds > 0) values.imapPollSeconds = imapPollSeconds
    values.imapSecure = imapSecure

    // SMTP — optional at setup time
    const smtpHost = (form.get('smtpHost') as string)?.trim()
    const smtpPort = Number(form.get('smtpPort'))
    const smtpUser = (form.get('smtpUser') as string)?.trim()
    const smtpPassword = (form.get('smtpPassword') as string)?.trim()
    const smtpFrom = (form.get('smtpFrom') as string)?.trim()
    const smtpSecure = form.get('smtpSecure') === 'true'

    if (smtpHost) values.smtpHost = smtpHost
    if (smtpPort > 0) values.smtpPort = smtpPort
    if (smtpUser) values.smtpUser = smtpUser
    if (smtpPassword) values.smtpPassword = smtpPassword
    if (smtpFrom) values.smtpFrom = smtpFrom
    values.smtpSecure = smtpSecure

    await db
      .insert(mailConfig)
      .values(values)
      .onConflictDoUpdate({ target: mailConfig.id, set: values })

    invalidateConfigCache()
    invalidateAuth()

    redirect(302, '/login')
  }
}
