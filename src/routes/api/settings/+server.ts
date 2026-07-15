import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { db } from '$lib/server/db'
import {
  account,
  mailConfig,
  mailSignature,
  mailboxCatalog,
  mailboxSync,
  mailMessageMailbox,
  mailThreadSummary,
  mailThreadMetadata,
  mailboxNotificationSetting,
  passkey
} from '$lib/server/db/schema'
import { and, eq, ilike, inArray, not, or } from 'drizzle-orm'
import {
  getAuthenticationConfig,
  getDisplayConfig,
  getImapConfig,
  invalidateConfigCache,
  isOAuthClientConfigured,
  isOidcConfigComplete
} from '$lib/server/config'
import { invalidateAuth } from '$lib/server/auth'
import {
  getCompactModeEnabled,
  getBlockRemoteContentEnabled,
  getRemoteContentAllowedSenders,
  getDensityPreference,
  getMailboxPreferences,
  getSimplifiedViewEnabled,
  getThemePreference,
  getThemeStyle,
  getThreadModeOnPageLoadEnabled,
  getTranslationTargetLanguage,
  normalizeDensityPreference,
  setBlockRemoteContentEnabled,
  setCompactModeEnabled,
  setDensityPreference,
  setMailboxPreferences,
  setRemoteContentAllowedSenders,
  setSimplifiedViewEnabled,
  setThemePreference,
  setThemeStyle,
  setThreadModeOnPageLoadEnabled,
  setTranslationTargetLanguage
} from '$lib/server/preferences'
import { logServerError } from '$lib/server/perf'
import { isDemoModeEnabled, saveDemoSettings } from '$lib/server/demo'
import { encryptSecret } from '$lib/server/secrets'
import { writeAuditLog } from '$lib/server/audit-log'
import { getImapMailboxes } from '$lib/server/mail'
import {
  DEFAULT_QUIET_HOURS,
  normalizeQuietHoursTime,
  normalizeQuietHoursTimezone
} from '$lib/server/quiet-hours'
// Note: signature cache invalidation is client-side only (composer.svelte.ts)

type SignatureProfileInput = {
  id?: number
  name: string
  html: string
  isDefault: boolean
}

function parseServerArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
    )
  }

  return []
}

function normalizeServerPayload(
  value: unknown,
  previousServers: Record<string, unknown>[] = [],
  passwordMask = '••••••••'
) {
  if (!Array.isArray(value)) return null
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const server = item as Record<string, unknown>
    const id = typeof server.id === 'string' ? server.id.trim() : undefined
    const previous =
      (id ? previousServers.find((candidate) => candidate.id === id) : undefined) ??
      previousServers[index]
    const password = typeof server.password === 'string' ? server.password.trim() : ''
    const previousPassword = typeof previous?.password === 'string' ? previous.password : undefined
    return [
      {
        id,
        name: typeof server.name === 'string' ? server.name.trim() : undefined,
        host: typeof server.host === 'string' ? server.host.trim() : '',
        port:
          typeof server.port === 'number' && server.port > 0 ? Math.trunc(server.port) : undefined,
        secure: typeof server.secure === 'boolean' ? server.secure : undefined,
        user: typeof server.user === 'string' ? server.user.trim() : '',
        password:
          password && password !== passwordMask ? encryptSecret(password) : previousPassword,
        mailbox: typeof server.mailbox === 'string' ? server.mailbox.trim() : undefined,
        pollSeconds:
          typeof server.pollSeconds === 'number' && server.pollSeconds > 0
            ? Math.trunc(server.pollSeconds)
            : undefined,
        from: typeof server.from === 'string' ? server.from.trim() : undefined
      }
    ]
  })
}

function isAllowedAuthUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  } catch {
    return false
  }
}

export const GET: RequestHandler = async ({ cookies }) => {
  const config = await getDisplayConfig()
  return json({
    ...config,
    simplifiedView: getSimplifiedViewEnabled(cookies),
    threadModeOnPageLoad: getThreadModeOnPageLoadEnabled(cookies),
    density: getDensityPreference(cookies),
    compactMode: getCompactModeEnabled(cookies),
    themePreference: getThemePreference(cookies),
    themeStyle: getThemeStyle(cookies),
    translationTargetLanguage: getTranslationTargetLanguage(cookies),
    remoteContent: {
      blockRemoteContent: getBlockRemoteContentEnabled(cookies),
      allowedSenders: getRemoteContentAllowedSenders(cookies)
    },
    mailboxPreferences: getMailboxPreferences(cookies)
  })
}

export const POST: RequestHandler = async (event) => {
  const { request, cookies } = event
  const body = await request.json()

  if (isDemoModeEnabled()) {
    saveDemoSettings(body as Record<string, unknown>)

    if (typeof body.simplifiedView === 'boolean') {
      setSimplifiedViewEnabled(cookies, body.simplifiedView)
    }

    if (typeof body.threadModeOnPageLoad === 'boolean') {
      setThreadModeOnPageLoadEnabled(cookies, body.threadModeOnPageLoad)
    }

    if (typeof body.compactMode === 'boolean') {
      setCompactModeEnabled(cookies, body.compactMode)
    }

    if (typeof body.themePreference === 'string') {
      setThemePreference(cookies, body.themePreference)
    }

    if (body.themeStyle && typeof body.themeStyle === 'object') {
      setThemeStyle(cookies, body.themeStyle)
    }

    const density = normalizeDensityPreference(body.density)
    if (density) {
      setDensityPreference(cookies, density)
    }

    if (typeof body.translationTargetLanguage === 'string') {
      setTranslationTargetLanguage(cookies, body.translationTargetLanguage)
    }

    if (body.remoteContent && typeof body.remoteContent === 'object') {
      const remoteContent = body.remoteContent as Record<string, unknown>
      if (typeof remoteContent.blockRemoteContent === 'boolean') {
        setBlockRemoteContentEnabled(cookies, remoteContent.blockRemoteContent)
      }
      if (Array.isArray(remoteContent.allowedSenders)) {
        setRemoteContentAllowedSenders(
          cookies,
          remoteContent.allowedSenders.filter((value): value is string => typeof value === 'string')
        )
      }
    }

    if (body.mailboxPreferences && typeof body.mailboxPreferences === 'object') {
      const mailboxes = await getImapMailboxes()
      setMailboxPreferences(
        cookies,
        body.mailboxPreferences,
        mailboxes.map((mailbox) => mailbox.path)
      )
    }

    return json({ success: true })
  }

  let shouldPersistConfig = false
  const [existingConfig] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  const currentAuthentication = await getAuthenticationConfig()
  const currentOidc = currentAuthentication.oidc
  const nextGithub = { ...currentAuthentication.github }
  const nextDiscord = { ...currentAuthentication.discord }
  const nextOidc = { ...currentOidc }
  let oidcIdentityChanged = false

  const values: typeof mailConfig.$inferInsert = {
    id: 1,
    updatedAt: new Date()
  }

  // IMAP fields — only persist non-empty strings, keep null for "use env var"
  let primaryImapChanged = false
  if (body.imap) {
    shouldPersistConfig = true
    const imap = body.imap as Record<string, unknown>
    const nextHost = typeof imap.host === 'string' ? imap.host.trim() || null : null
    const nextUser = typeof imap.user === 'string' ? imap.user.trim() || null : null

    const currentImap = await getImapConfig()
    const currentHost = 'host' in currentImap ? currentImap.host : null
    const currentUser = 'user' in currentImap ? currentImap.user : null

    if (
      (nextHost !== null && currentHost !== nextHost) ||
      (nextUser !== null && currentUser !== nextUser)
    ) {
      primaryImapChanged = true
    }

    if (typeof imap.host === 'string') values.imapHost = imap.host.trim() || null
    if (typeof imap.port === 'number') values.imapPort = imap.port > 0 ? imap.port : null
    if (typeof imap.secure === 'boolean') values.imapSecure = imap.secure
    if (typeof imap.user === 'string') values.imapUser = imap.user.trim() || null
    // Empty password means "leave existing / use env" — don't overwrite with empty
    if (typeof imap.password === 'string' && imap.password.trim() && imap.password !== '••••••••') {
      values.imapPassword = encryptSecret(imap.password)
    }
    if (typeof imap.mailbox === 'string') values.imapMailbox = imap.mailbox.trim() || null
    if (typeof imap.pollSeconds === 'number')
      values.imapPollSeconds = imap.pollSeconds > 0 ? imap.pollSeconds : null
  }

  const imapServers = normalizeServerPayload(
    body.imapServers,
    parseServerArray(existingConfig?.imapServers)
  )
  const obsoleteServerNames: string[] = []
  if (imapServers) {
    shouldPersistConfig = true
    values.imapServers = imapServers

    const oldImapServers = parseServerArray(existingConfig?.imapServers)
    console.log('[DEBUG-CLEANUP] oldImapServers:', JSON.stringify(oldImapServers))
    console.log('[DEBUG-CLEANUP] newImapServers:', JSON.stringify(imapServers))
    for (const oldServer of oldImapServers) {
      const oldId = oldServer.id as string
      const oldName = oldServer.name as string
      if (!oldName) continue

      const newServer = imapServers.find((s) => s.id === oldId)
      console.log(
        `[DEBUG-CLEANUP] Checking server: ${oldName} (id: ${oldId}). Found match:`,
        JSON.stringify(newServer)
      )
      if (!newServer || newServer.name !== oldName) {
        console.log(`[DEBUG-CLEANUP] Found obsolete server name: ${oldName}`)
        obsoleteServerNames.push(oldName)
      }
    }
    console.log('[DEBUG-CLEANUP] obsoleteServerNames to delete:', obsoleteServerNames)
  }

  // SMTP fields
  if (body.smtp) {
    shouldPersistConfig = true
    const smtp = body.smtp as Record<string, unknown>
    if (typeof smtp.host === 'string') values.smtpHost = smtp.host.trim() || null
    if (typeof smtp.port === 'number') values.smtpPort = smtp.port > 0 ? smtp.port : null
    if (typeof smtp.secure === 'boolean') values.smtpSecure = smtp.secure
    if (typeof smtp.user === 'string') values.smtpUser = smtp.user.trim() || null
    if (typeof smtp.password === 'string' && smtp.password.trim() && smtp.password !== '••••••••') {
      values.smtpPassword = encryptSecret(smtp.password)
    }
    if (typeof smtp.from === 'string') values.smtpFrom = smtp.from.trim() || null
    if (typeof smtp.undoSendSeconds === 'number') {
      values.smtpUndoSendSeconds = Math.min(30, Math.max(0, Math.floor(smtp.undoSendSeconds)))
    }
  }

  const smtpServers = normalizeServerPayload(
    body.smtpServers,
    parseServerArray(existingConfig?.smtpServers)
  )
  if (smtpServers) {
    shouldPersistConfig = true
    values.smtpServers = smtpServers
  }

  // Signature
  if (typeof body.signature === 'string') {
    shouldPersistConfig = true
    values.signature = body.signature
  }

  const signatureProfilePayload = Array.isArray(body.signatureProfiles)
    ? (body.signatureProfiles as unknown[])
    : null
  const signatureProfiles: SignatureProfileInput[] | null = signatureProfilePayload
    ? signatureProfilePayload
        .filter(
          (signature): signature is Record<string, unknown> =>
            Boolean(signature) && typeof signature === 'object'
        )
        .map((signature, index) => ({
          id: typeof signature.id === 'number' && signature.id > 0 ? signature.id : undefined,
          name:
            typeof signature.name === 'string' && signature.name.trim()
              ? signature.name.trim()
              : `Signature ${index + 1}`,
          html: typeof signature.html === 'string' ? signature.html : '',
          isDefault: signature.isDefault === true
        }))
    : null

  if (signatureProfiles?.length && !signatureProfiles.some((signature) => signature.isDefault)) {
    signatureProfiles[0].isDefault = true
  }

  if (signatureProfiles) {
    shouldPersistConfig = true
    values.signature = signatureProfiles.find((signature) => signature.isDefault)?.html ?? ''
  }

  // Authentication providers
  if (body.github) {
    shouldPersistConfig = true
    const github = body.github as Record<string, unknown>
    const clientSecret = typeof github.clientSecret === 'string' ? github.clientSecret.trim() : ''
    const submittedSecret = Boolean(clientSecret && clientSecret !== '••••••••')
    if (typeof github.clientId === 'string') {
      const clientId = github.clientId.trim()
      values.githubClientId = clientId || null
      nextGithub.clientId = clientId || env.GITHUB_CLIENT_ID || ''
    }
    if (submittedSecret) {
      nextGithub.clientSecret = clientSecret
      values.githubClientSecret = encryptSecret(clientSecret)
    }
    if (
      nextGithub.clientId &&
      nextGithub.clientId !== currentAuthentication.github.clientId &&
      !submittedSecret
    ) {
      return error(400, 'Enter the GitHub Client Secret when changing the Client ID.')
    }
    if (nextGithub.clientId && !nextGithub.clientSecret) {
      return error(400, 'GitHub Client ID and Client Secret are both required.')
    }
  }

  if (body.discord) {
    shouldPersistConfig = true
    const discord = body.discord as Record<string, unknown>
    const clientSecret = typeof discord.clientSecret === 'string' ? discord.clientSecret.trim() : ''
    const submittedSecret = Boolean(clientSecret && clientSecret !== '••••••••')
    if (typeof discord.clientId === 'string') {
      const clientId = discord.clientId.trim()
      values.discordClientId = clientId || null
      nextDiscord.clientId = clientId || env.DISCORD_CLIENT_ID || ''
    }
    if (submittedSecret) {
      nextDiscord.clientSecret = clientSecret
      values.discordClientSecret = encryptSecret(clientSecret)
    }
    if (
      nextDiscord.clientId &&
      nextDiscord.clientId !== currentAuthentication.discord.clientId &&
      !submittedSecret
    ) {
      return error(400, 'Enter the Discord Client Secret when changing the Client ID.')
    }
    if (nextDiscord.clientId && !nextDiscord.clientSecret) {
      return error(400, 'Discord Client ID and Client Secret are both required.')
    }
  }

  if (body.oidc) {
    shouldPersistConfig = true
    const oidc = body.oidc as Record<string, unknown>
    const clientSecret = typeof oidc.clientSecret === 'string' ? oidc.clientSecret.trim() : ''
    const submittedSecret = Boolean(clientSecret && clientSecret !== '••••••••')
    if (typeof oidc.issuer === 'string') {
      const issuer = oidc.issuer.trim()
      nextOidc.issuer = issuer || env.OIDC_ISSUER || ''
      values.oidcIssuer = issuer || null
      if (issuer !== currentOidc.issuer) {
        values.oidcSubject = null
      }
      if (issuer) {
        values.oidcDiscoveryUrl = null
        nextOidc.legacyDiscoveryUrl = ''
      }
    }
    if (typeof oidc.authorizationUrl === 'string') {
      const authorizationUrl = oidc.authorizationUrl.trim()
      nextOidc.authorizationUrl = authorizationUrl || env.OIDC_AUTHORIZATION_URL || ''
      values.oidcAuthorizationUrl = authorizationUrl || null
    }
    if (typeof oidc.tokenUrl === 'string') {
      const tokenUrl = oidc.tokenUrl.trim()
      nextOidc.tokenUrl = tokenUrl || env.OIDC_TOKEN_URL || ''
      values.oidcTokenUrl = tokenUrl || null
    }
    if (typeof oidc.userInfoUrl === 'string') {
      const userInfoUrl = oidc.userInfoUrl.trim()
      nextOidc.userInfoUrl = userInfoUrl || env.OIDC_USER_INFO_URL || ''
      values.oidcUserInfoUrl = userInfoUrl || null
    }
    if (typeof oidc.clientId === 'string') {
      const clientId = oidc.clientId.trim()
      nextOidc.clientId = clientId || env.OIDC_CLIENT_ID || ''
      values.oidcClientId = clientId || null
    }
    if (submittedSecret) {
      nextOidc.clientSecret = clientSecret
      values.oidcClientSecret = encryptSecret(clientSecret)
    }

    const currentIdentity = currentOidc.issuer || currentOidc.legacyDiscoveryUrl
    const nextOidcIdentity = nextOidc.issuer || nextOidc.legacyDiscoveryUrl
    oidcIdentityChanged = Boolean(currentIdentity && currentIdentity !== nextOidcIdentity)
    if (oidcIdentityChanged) {
      values.oidcSubject = null
      values.oidcSubjectDiscoveryUrl = nextOidcIdentity || null
    }
    const manualUrls = [
      nextOidc.issuer,
      nextOidc.authorizationUrl,
      nextOidc.tokenUrl,
      nextOidc.userInfoUrl
    ]
    const visibleValues = [...manualUrls, nextOidc.clientId]
    if (visibleValues.some(Boolean) && !isOidcConfigComplete(nextOidc)) {
      return error(400, 'All manual OIDC endpoints, Client ID, and Client Secret are required.')
    }
    if (
      isOidcConfigComplete(nextOidc) &&
      (oidcIdentityChanged || nextOidc.clientId !== currentOidc.clientId) &&
      !submittedSecret
    ) {
      return error(400, 'Enter the OIDC Client Secret when changing the issuer or Client ID.')
    }
    if (manualUrls.some(Boolean) && !manualUrls.every(isAllowedAuthUrl)) {
      return error(400, 'OIDC endpoints must be valid HTTPS URLs.')
    }
  }

  if (body.github || body.discord || body.oidc) {
    const userId = event.locals.user?.id
    const [[credential], [registeredPasskey], linkedAccounts] = userId
      ? await Promise.all([
          db
            .select({ id: account.id })
            .from(account)
            .where(
              and(
                eq(account.userId, userId),
                inArray(account.providerId, ['credential', 'email-password'])
              )
            )
            .limit(1),
          db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).limit(1),
          db
            .select({ providerId: account.providerId })
            .from(account)
            .where(
              and(
                eq(account.userId, userId),
                inArray(account.providerId, ['github', 'discord', 'oidc'])
              )
            )
        ])
      : [[], [], []]
    const linkedProviderIds = new Set(linkedAccounts.map((linked) => linked.providerId))
    const hasExternalProvider =
      (isOAuthClientConfigured(nextGithub) && linkedProviderIds.has('github')) ||
      (isOAuthClientConfigured(nextDiscord) && linkedProviderIds.has('discord')) ||
      (isOidcConfigComplete(nextOidc) && !oidcIdentityChanged && linkedProviderIds.has('oidc'))
    if (!credential && !registeredPasskey && !hasExternalProvider) {
      return error(400, 'At least one login method must remain configured.')
    }
  }

  if (body.quietHours) {
    shouldPersistConfig = true
    const quietHours = body.quietHours as Record<string, unknown>
    if (typeof quietHours.enabled === 'boolean') values.quietHoursEnabled = quietHours.enabled
    if (typeof quietHours.start === 'string') {
      values.quietHoursStart = normalizeQuietHoursTime(quietHours.start, DEFAULT_QUIET_HOURS.start)
    }
    if (typeof quietHours.end === 'string') {
      values.quietHoursEnd = normalizeQuietHoursTime(quietHours.end, DEFAULT_QUIET_HOURS.end)
    }
    if (typeof quietHours.timezone === 'string') {
      values.quietHoursTimezone = normalizeQuietHoursTimezone(
        quietHours.timezone,
        DEFAULT_QUIET_HOURS.timezone
      )
    }
  }

  try {
    if (shouldPersistConfig) {
      await db.transaction(async (tx) => {
        await tx.insert(mailConfig).values(values).onConflictDoUpdate({
          target: mailConfig.id,
          set: values
        })
        if (oidcIdentityChanged && event.locals.user) {
          await tx
            .delete(account)
            .where(and(eq(account.userId, event.locals.user.id), eq(account.providerId, 'oidc')))
        }
        if (primaryImapChanged) {
          const activeSecondaryNames = parseServerArray(values.imapServers || existingConfig?.imapServers)
            .map((s) => s.name as string)
            .filter(Boolean)

          console.log('[DEBUG-CLEANUP] Primary IMAP changed. Cleaning legacy primary mailboxes. Active secondary names:', activeSecondaryNames)

          const buildPrimaryExcludeCondition = (field: any) => {
            if (activeSecondaryNames.length === 0) return undefined
            return and(
              ...activeSecondaryNames.flatMap((name) => [
                not(ilike(field, name)),
                not(ilike(field, `${name}/%`))
              ])
            )
          }

          const catalogCond = buildPrimaryExcludeCondition(mailboxCatalog.path)
          if (catalogCond) {
            await tx.delete(mailboxCatalog).where(catalogCond)
          } else {
            await tx.delete(mailboxCatalog)
          }

          const syncCond = buildPrimaryExcludeCondition(mailboxSync.mailbox)
          if (syncCond) {
            await tx.delete(mailboxSync).where(syncCond)
          } else {
            await tx.delete(mailboxSync)
          }

          const msgMailboxCond = buildPrimaryExcludeCondition(mailMessageMailbox.mailbox)
          if (msgMailboxCond) {
            await tx.delete(mailMessageMailbox).where(msgMailboxCond)
          } else {
            await tx.delete(mailMessageMailbox)
          }

          const threadSummaryCond = buildPrimaryExcludeCondition(mailThreadSummary.mailbox)
          if (threadSummaryCond) {
            await tx.delete(mailThreadSummary).where(threadSummaryCond)
          } else {
            await tx.delete(mailThreadSummary)
          }

          const threadMetadataCond = buildPrimaryExcludeCondition(mailThreadMetadata.mailbox)
          if (threadMetadataCond) {
            await tx.delete(mailThreadMetadata).where(threadMetadataCond)
          } else {
            await tx.delete(mailThreadMetadata)
          }

          const notificationCond = buildPrimaryExcludeCondition(mailboxNotificationSetting.mailbox)
          if (notificationCond) {
            await tx.delete(mailboxNotificationSetting).where(notificationCond)
          } else {
            await tx.delete(mailboxNotificationSetting)
          }
        }
      })
    }

    if (obsoleteServerNames.length > 0) {
      console.log('[DEBUG-CLEANUP] Starting DB cleanup transaction for:', obsoleteServerNames)
      await db.transaction(async (tx) => {
        for (const name of obsoleteServerNames) {
          const prefix = `${name}/`
          console.log(`[DEBUG-CLEANUP] Cleaning up database records for prefix: ${prefix}`)

          await tx
            .delete(mailboxCatalog)
            .where(or(ilike(mailboxCatalog.path, name), ilike(mailboxCatalog.path, `${prefix}%`)))
          await tx
            .delete(mailboxSync)
            .where(or(ilike(mailboxSync.mailbox, name), ilike(mailboxSync.mailbox, `${prefix}%`)))
          await tx
            .delete(mailMessageMailbox)
            .where(
              or(
                ilike(mailMessageMailbox.mailbox, name),
                ilike(mailMessageMailbox.mailbox, `${prefix}%`)
              )
            )
          await tx
            .delete(mailThreadSummary)
            .where(
              or(
                ilike(mailThreadSummary.mailbox, name),
                ilike(mailThreadSummary.mailbox, `${prefix}%`)
              )
            )
          await tx
            .delete(mailThreadMetadata)
            .where(
              or(
                ilike(mailThreadMetadata.mailbox, name),
                ilike(mailThreadMetadata.mailbox, `${prefix}%`)
              )
            )
          await tx
            .delete(mailboxNotificationSetting)
            .where(
              or(
                ilike(mailboxNotificationSetting.mailbox, name),
                ilike(mailboxNotificationSetting.mailbox, `${prefix}%`)
              )
            )
        }
      })
    }

    if (signatureProfiles) {
      await db.delete(mailSignature)
      if (signatureProfiles.length > 0) {
        await db.insert(mailSignature).values(
          signatureProfiles.map((signature) => ({
            name: signature.name,
            html: signature.html,
            isDefault: signature.isDefault,
            updatedAt: new Date()
          }))
        )
      }
    }

    if (typeof body.simplifiedView === 'boolean') {
      setSimplifiedViewEnabled(cookies, body.simplifiedView)
    }

    if (typeof body.threadModeOnPageLoad === 'boolean') {
      setThreadModeOnPageLoadEnabled(cookies, body.threadModeOnPageLoad)
    }

    if (typeof body.compactMode === 'boolean') {
      setCompactModeEnabled(cookies, body.compactMode)
    }

    if (typeof body.themePreference === 'string') {
      setThemePreference(cookies, body.themePreference)
    }

    if (body.themeStyle && typeof body.themeStyle === 'object') {
      setThemeStyle(cookies, body.themeStyle)
    }

    const density = normalizeDensityPreference(body.density)
    if (density) {
      setDensityPreference(cookies, density)
    }

    if (typeof body.translationTargetLanguage === 'string') {
      setTranslationTargetLanguage(cookies, body.translationTargetLanguage)
    }

    if (body.remoteContent && typeof body.remoteContent === 'object') {
      const remoteContent = body.remoteContent as Record<string, unknown>
      if (typeof remoteContent.blockRemoteContent === 'boolean') {
        setBlockRemoteContentEnabled(cookies, remoteContent.blockRemoteContent)
      }
      if (Array.isArray(remoteContent.allowedSenders)) {
        setRemoteContentAllowedSenders(
          cookies,
          remoteContent.allowedSenders.filter((value): value is string => typeof value === 'string')
        )
      }
    }

    if (body.mailboxPreferences && typeof body.mailboxPreferences === 'object') {
      const mailboxes = await getImapMailboxes()
      setMailboxPreferences(
        cookies,
        body.mailboxPreferences,
        mailboxes.map((mailbox) => mailbox.path)
      )
    }

    if (shouldPersistConfig) {
      invalidateConfigCache()
      invalidateAuth()
    }

    const changedSettings = Object.keys(values).filter((key) => key !== 'id' && key !== 'updatedAt')
    const preferenceChanges = [
      typeof body.simplifiedView === 'boolean' ? 'simplifiedView' : null,
      typeof body.threadModeOnPageLoad === 'boolean' ? 'threadModeOnPageLoad' : null,
      typeof body.compactMode === 'boolean' ? 'compactMode' : null,
      typeof body.themePreference === 'string' ? 'themePreference' : null,
      body.themeStyle && typeof body.themeStyle === 'object' ? 'themeStyle' : null,
      typeof body.translationTargetLanguage === 'string' ? 'translationTargetLanguage' : null,
      body.mailboxPreferences && typeof body.mailboxPreferences === 'object'
        ? 'mailboxPreferences'
        : null
    ].filter(Boolean)

    if (changedSettings.length > 0 || preferenceChanges.length > 0) {
      await writeAuditLog({
        action: 'settings.update',
        entityType: 'settings',
        summary: 'Updated application settings',
        metadata: {
          changedSettings,
          preferenceChanges,
          sections: {
            imap: Boolean(body.imap),
            smtp: Boolean(body.smtp),
            github: Boolean(body.github),
            discord: Boolean(body.discord),
            oidc: Boolean(body.oidc),
            signature: typeof body.signature === 'string'
          },
          secretsUpdated: {
            imapPassword: 'imapPassword' in values,
            smtpPassword: 'smtpPassword' in values,
            githubClientSecret: 'githubClientSecret' in values,
            discordClientSecret: 'discordClientSecret' in values,
            oidcClientSecret: 'oidcClientSecret' in values
          }
        },
        event
      })
    }

    return json({ success: true })
  } catch (err) {
    logServerError('api.settings.POST.save', err, {
      hasImap: Boolean(body.imap),
      hasSmtp: Boolean(body.smtp),
      hasGithub: Boolean(body.github),
      hasDiscord: Boolean(body.discord),
      hasOidc: Boolean(body.oidc),
      density: normalizeDensityPreference(body.density) ?? 'unchanged',
      compactMode: typeof body.compactMode === 'boolean' ? body.compactMode : 'unchanged',
      simplifiedView: typeof body.simplifiedView === 'boolean' ? body.simplifiedView : 'unchanged',
      threadModeOnPageLoad:
        typeof body.threadModeOnPageLoad === 'boolean' ? body.threadModeOnPageLoad : 'unchanged',
      themePreference:
        typeof body.themePreference === 'string' ? body.themePreference : 'unchanged',
      translationTargetLanguage:
        typeof body.translationTargetLanguage === 'string'
          ? body.translationTargetLanguage
          : 'unchanged',
      remoteContent: body.remoteContent ? 'changed' : 'unchanged'
    })
    const message = err instanceof Error ? err.message : String(err)
    return error(500, `Failed to save settings: ${message}`)
  }
}
