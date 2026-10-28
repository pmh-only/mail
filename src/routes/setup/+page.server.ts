import type { Actions, PageServerLoad } from './$types'
import { redirect, fail } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { mailConfig, user } from '$lib/server/db/schema'
import { invalidateConfigCache, isAuthenticationConfigured } from '$lib/server/config'
import { createSetupAuth, invalidateAuth } from '$lib/server/auth'
import { env } from '$lib/server/env-private'
import { isDemoModeEnabled } from '$lib/server/demo'
import { encryptSecret } from '$lib/server/secrets'
import { writeAuditLog } from '$lib/server/audit-log'
import { eq } from 'drizzle-orm'

export const load: PageServerLoad = async () => {
  if (isDemoModeEnabled()) {
    redirect(302, '/')
  }
  if (await isAuthenticationConfigured()) {
    redirect(302, '/')
  }
  return { origin: env.ORIGIN ?? '' }
}

export const actions: Actions = {
  default: async (event) => {
    const { request } = event
    if (isDemoModeEnabled()) {
      redirect(302, '/')
    }
    if (await isAuthenticationConfigured()) {
      redirect(302, '/')
    }
    const form = await request.formData()

    const adminName = (form.get('adminName') as string)?.trim()
    const adminEmail = (form.get('adminEmail') as string)?.trim()
    const adminPassword = (form.get('adminPassword') as string) ?? ''
    const githubClientId = (form.get('githubClientId') as string)?.trim()
    const githubClientSecret = (form.get('githubClientSecret') as string)?.trim()
    const discordClientId = (form.get('discordClientId') as string)?.trim()
    const discordClientSecret = (form.get('discordClientSecret') as string)?.trim()
    const oidcIssuer = (form.get('oidcIssuer') as string)?.trim()
    const oidcAuthorizationUrl = (form.get('oidcAuthorizationUrl') as string)?.trim()
    const oidcTokenUrl = (form.get('oidcTokenUrl') as string)?.trim()
    const oidcUserInfoUrl = (form.get('oidcUserInfoUrl') as string)?.trim()
    const oidcClientId = (form.get('oidcClientId') as string)?.trim()
    const oidcClientSecret = (form.get('oidcClientSecret') as string)?.trim()

    const passwordValues = [adminName, adminEmail, adminPassword]
    const githubValues = [githubClientId, githubClientSecret]
    const discordValues = [discordClientId, discordClientSecret]
    const oidcValues = [
      oidcIssuer,
      oidcAuthorizationUrl,
      oidcTokenUrl,
      oidcUserInfoUrl,
      oidcClientId,
      oidcClientSecret
    ]
    const passwordConfigured = passwordValues.every(Boolean)
    const githubConfigured = githubValues.every(Boolean)
    const discordConfigured = discordValues.every(Boolean)
    const oidcConfigured = oidcValues.every(Boolean)

    if (passwordValues.some(Boolean) && !passwordConfigured) {
      return fail(400, { error: 'Name, email, and password are all required for password login.' })
    }
    if (passwordConfigured && (adminPassword.length < 8 || adminPassword.length > 128)) {
      return fail(400, { error: 'The login password must be between 8 and 128 characters.' })
    }
    if (githubValues.some(Boolean) && !githubConfigured) {
      return fail(400, { error: 'GitHub Client ID and Client Secret are both required.' })
    }
    if (discordValues.some(Boolean) && !discordConfigured) {
      return fail(400, { error: 'Discord Client ID and Client Secret are both required.' })
    }
    if (oidcValues.some(Boolean) && !oidcConfigured) {
      return fail(400, { error: 'All manual OIDC fields are required when OIDC is configured.' })
    }
    if (!passwordConfigured && !githubConfigured && !discordConfigured && !oidcConfigured) {
      return fail(400, { error: 'Configure at least one login method.' })
    }

    if (oidcConfigured) {
      try {
        for (const value of [oidcIssuer, oidcAuthorizationUrl, oidcTokenUrl, oidcUserInfoUrl]) {
          const url = new URL(value)
          if (
            url.protocol !== 'https:' &&
            !(url.protocol === 'http:' && url.hostname === 'localhost')
          ) {
            throw new Error()
          }
        }
      } catch {
        return fail(400, { error: 'OIDC endpoints must be valid HTTPS URLs.' })
      }
    }

    const values: typeof mailConfig.$inferInsert = {
      id: 1,
      authSetupComplete: true,
      githubClientId: githubClientId || null,
      githubClientSecret: githubClientSecret ? encryptSecret(githubClientSecret) : null,
      discordClientId: discordClientId || null,
      discordClientSecret: discordClientSecret ? encryptSecret(discordClientSecret) : null,
      oidcIssuer: oidcIssuer || null,
      oidcAuthorizationUrl: oidcAuthorizationUrl || null,
      oidcTokenUrl: oidcTokenUrl || null,
      oidcUserInfoUrl: oidcUserInfoUrl || null,
      oidcClientId: oidcClientId || null,
      oidcClientSecret: oidcClientSecret ? encryptSecret(oidcClientSecret) : null,
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
    const imapAllowInvalidCertificate = form.get('imapAllowInvalidCertificate') === 'true'

    if (imapHost) values.imapHost = imapHost
    if (imapPort > 0) values.imapPort = imapPort
    if (imapUser) values.imapUser = imapUser
    if (imapPassword) values.imapPassword = encryptSecret(imapPassword)
    if (imapMailbox) values.imapMailbox = imapMailbox
    if (imapPollSeconds > 0) values.imapPollSeconds = imapPollSeconds
    values.imapSecure = imapSecure
    values.imapAllowInvalidCertificate = imapAllowInvalidCertificate

    // SMTP — optional at setup time
    const smtpHost = (form.get('smtpHost') as string)?.trim()
    const smtpPort = Number(form.get('smtpPort'))
    const smtpUser = (form.get('smtpUser') as string)?.trim()
    const smtpPassword = (form.get('smtpPassword') as string)?.trim()
    const smtpFrom = (form.get('smtpFrom') as string)?.trim()
    const smtpSecure = form.get('smtpSecure') === 'true'
    const smtpAllowInvalidCertificate = form.get('smtpAllowInvalidCertificate') === 'true'

    if (smtpHost) values.smtpHost = smtpHost
    if (smtpPort > 0) values.smtpPort = smtpPort
    if (smtpUser) values.smtpUser = smtpUser
    if (smtpPassword) values.smtpPassword = encryptSecret(smtpPassword)
    if (smtpFrom) values.smtpFrom = smtpFrom
    values.smtpSecure = smtpSecure
    values.smtpAllowInvalidCertificate = smtpAllowInvalidCertificate

    let createdAuthUserId: string | undefined
    if (passwordConfigured) {
      try {
        const setupAuth = await createSetupAuth()
        const result = await setupAuth.api.signUpEmail({
          body: { name: adminName, email: adminEmail, password: adminPassword },
          headers: request.headers
        })
        createdAuthUserId = result.user.id
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Failed to create the password account.'
        return fail(400, { error: message })
      }
    }

    let setupSaved: boolean
    try {
      setupSaved = await db.transaction(async (tx) => {
        await tx.insert(mailConfig).values({ id: 1 }).onConflictDoNothing({ target: mailConfig.id })
        const [current] = await tx
          .select({ complete: mailConfig.authSetupComplete })
          .from(mailConfig)
          .where(eq(mailConfig.id, 1))
          .limit(1)
          .for('update')
        if (current?.complete) return false

        await tx
          .update(mailConfig)
          .set({ ...values, authUserId: createdAuthUserId })
          .where(eq(mailConfig.id, 1))
        return true
      })
    } catch (cause) {
      if (createdAuthUserId) {
        await db
          .delete(user)
          .where(eq(user.id, createdAuthUserId))
          .catch(() => undefined)
      }
      const message = cause instanceof Error ? cause.message : 'Failed to complete setup.'
      return fail(400, { error: message })
    }
    if (!setupSaved) {
      if (createdAuthUserId) {
        await db
          .delete(user)
          .where(eq(user.id, createdAuthUserId))
          .catch(() => undefined)
      }
      return fail(409, { error: 'Another setup request already completed this installation.' })
    }

    invalidateConfigCache()
    invalidateAuth()

    await writeAuditLog({
      action: 'security.setup.complete',
      entityType: 'settings',
      summary: 'Completed initial application setup',
      metadata: {
        sections: {
          password: passwordConfigured,
          github: githubConfigured,
          discord: discordConfigured,
          oidc: oidcConfigured,
          imap: Boolean(imapHost || imapPort || imapUser || imapPassword || imapMailbox),
          smtp: Boolean(smtpHost || smtpPort || smtpUser || smtpPassword || smtpFrom)
        },
        secretsUpdated: {
          loginPassword: passwordConfigured,
          githubClientSecret: githubConfigured,
          discordClientSecret: discordConfigured,
          oidcClientSecret: oidcConfigured,
          imapPassword: Boolean(imapPassword),
          smtpPassword: Boolean(smtpPassword)
        }
      },
      event
    })

    redirect(302, '/login')
  }
}
