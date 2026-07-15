/**
 * Mail configuration loader.
 * DB values (mail_config table, id=1) take priority over environment variables.
 */
import { env } from '$env/dynamic/private'
import { db } from './db'
import { mailConfig, mailSignature } from './db/schema'
import { asc, desc, eq } from 'drizzle-orm'
import {
  getDemoDisplayConfig,
  getDemoImapConfig,
  getDemoOidcConfig,
  getDemoSignatureProfiles,
  getDemoSmtpConfig,
  isDemoModeEnabled
} from './demo'
import {
  decryptSecret,
  encryptSecret,
  getSecretStorageStatus,
  isEncryptedSecret,
  isSecretEncryptionConfigured
} from './secrets'
import {
  DEFAULT_QUIET_HOURS,
  normalizeQuietHoursTime,
  normalizeQuietHoursTimezone,
  type QuietHoursConfig
} from './quiet-hours'

export type ImapConfig = {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  mailbox: string
  pollSeconds: number
}

export type SmtpConfig = {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export type OAuthClientConfig = {
  clientId: string
  clientSecret: string
}

export type OidcConfig = OAuthClientConfig & {
  issuer: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  legacyDiscoveryUrl: string
}

export type AuthenticationConfig = {
  github: OAuthClientConfig
  discord: OAuthClientConfig
  oidc: OidcConfig
}

export type MailConfigRow = typeof mailConfig.$inferSelect
export type MailSignatureRow = typeof mailSignature.$inferSelect

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return value.toLowerCase() !== 'false'
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseServerArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    )
  }

  if (typeof value !== 'string' || !value.trim()) return []

  try {
    const parsed = JSON.parse(value) as unknown
    return parseServerArray(parsed)
  } catch {
    return []
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function decryptMaybe(value: unknown): string {
  const password = asString(value)
  return password ? decryptSecret(password) : ''
}

function withServerIdentity(index: number, value: Record<string, unknown>) {
  const id = asString(value.id) || (index === 0 ? 'primary' : `server-${index + 1}`)
  return {
    id,
    name: asString(value.name) || (id === 'primary' ? 'Primary' : id)
  }
}

function fromLegacyImap(row: MailConfigRow | null): ImapConfig | null {
  const host = row?.imapHost || env.IMAP_HOST || ''
  const user = row?.imapUser || env.IMAP_USER || ''
  const password = row?.imapPassword ? decryptSecret(row.imapPassword) : env.IMAP_PASSWORD || ''
  if (!host || !user || !password) return null

  return {
    id: 'primary',
    name: 'Primary',
    host,
    port: row?.imapPort ?? parseNumber(env.IMAP_PORT, 993),
    secure: row?.imapSecure ?? parseBoolean(env.IMAP_SECURE, true),
    user,
    password,
    mailbox: row?.imapMailbox || env.IMAP_MAILBOX || 'INBOX',
    pollSeconds: row?.imapPollSeconds ?? parseNumber(env.IMAP_POLL_SECONDS, 15)
  }
}

export function normalizeImapServers(row: MailConfigRow | null): ImapConfig[] {
  const sources = [...parseServerArray(row?.imapServers), ...parseServerArray(env.IMAP_SERVERS)]
  const servers = sources.flatMap((server, index) => {
    const host = asString(server.host)
    const user = asString(server.user)
    const password = decryptMaybe(server.password)
    if (!host || !user || !password) return []
    const identity = withServerIdentity(index + 1, server)
    return [
      {
        ...identity,
        host,
        port: asNumber(server.port, 993),
        secure: asBoolean(server.secure, true),
        user,
        password,
        mailbox: asString(server.mailbox) || 'INBOX',
        pollSeconds: asNumber(server.pollSeconds, 15)
      }
    ]
  })
  const legacy = fromLegacyImap(row)
  return legacy ? [legacy, ...servers] : servers
}

function fromLegacySmtp(row: MailConfigRow | null): SmtpConfig | null {
  const host = row?.smtpHost || env.SMTP_HOST || ''
  const user = row?.smtpUser || env.SMTP_USER || ''
  const password = row?.smtpPassword ? decryptSecret(row.smtpPassword) : env.SMTP_PASSWORD || ''
  if (!host || !user || !password) return null

  return {
    id: 'primary',
    name: 'Primary',
    host,
    port: row?.smtpPort ?? parseNumber(env.SMTP_PORT, 587),
    secure: row?.smtpSecure ?? parseBoolean(env.SMTP_SECURE, false),
    user,
    password,
    from: row?.smtpFrom || env.SMTP_FROM || user
  }
}

export function normalizeSmtpServers(row: MailConfigRow | null): SmtpConfig[] {
  const sources = [...parseServerArray(row?.smtpServers), ...parseServerArray(env.SMTP_SERVERS)]
  const servers = sources.flatMap((server, index) => {
    const host = asString(server.host)
    const user = asString(server.user)
    const password = decryptMaybe(server.password)
    if (!host || !user || !password) return []
    const identity = withServerIdentity(index + 1, server)
    return [
      {
        ...identity,
        host,
        port: asNumber(server.port, 587),
        secure: asBoolean(server.secure, false),
        user,
        password,
        from: asString(server.from) || user
      }
    ]
  })
  const legacy = fromLegacySmtp(row)
  return legacy ? [legacy, ...servers] : servers
}

function maskImap(config: ImapConfig, source: string) {
  return { ...config, password: config.password ? '••••••••' : '', source }
}

function maskSmtp(config: SmtpConfig, source: string) {
  return { ...config, password: config.password ? '••••••••' : '', source }
}

function parseUndoSendSeconds(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(30, Math.max(0, Math.floor(parsed)))
}

let cachedRow: MailConfigRow | null | undefined = undefined // undefined = not loaded yet
let cachedRowLoadedAt = 0
const CONFIG_CACHE_TTL_MS = 5_000

async function loadConfigRow(): Promise<MailConfigRow | null> {
  const [row] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  if (row && isSecretEncryptionConfigured()) {
    const updates: Partial<MailConfigRow> = {}
    if (row.imapPassword && !isEncryptedSecret(row.imapPassword)) {
      updates.imapPassword = encryptSecret(row.imapPassword)
    }
    if (row.smtpPassword && !isEncryptedSecret(row.smtpPassword)) {
      updates.smtpPassword = encryptSecret(row.smtpPassword)
    }
    if (row.githubClientSecret && !isEncryptedSecret(row.githubClientSecret)) {
      updates.githubClientSecret = encryptSecret(row.githubClientSecret)
    }
    if (row.discordClientSecret && !isEncryptedSecret(row.discordClientSecret)) {
      updates.discordClientSecret = encryptSecret(row.discordClientSecret)
    }
    if (row.oidcClientSecret && !isEncryptedSecret(row.oidcClientSecret)) {
      updates.oidcClientSecret = encryptSecret(row.oidcClientSecret)
    }

    if (Object.keys(updates).length > 0) {
      await db.update(mailConfig).set(updates).where(eq(mailConfig.id, 1))
      cachedRow = { ...row, ...updates }
      cachedRowLoadedAt = Date.now()
      return cachedRow
    }
  }

  cachedRow = row ?? null
  cachedRowLoadedAt = Date.now()
  return cachedRow ?? null
}

/** Call after saving settings to bust the cache. */
export function invalidateConfigCache() {
  cachedRow = undefined
  cachedRowLoadedAt = 0
}

async function getRow(): Promise<MailConfigRow | null> {
  if (isDemoModeEnabled()) return null
  if (cachedRow !== undefined && Date.now() - cachedRowLoadedAt < CONFIG_CACHE_TTL_MS) {
    return cachedRow
  }
  return loadConfigRow()
}

export async function getImapConfig(): Promise<ImapConfig | { missing: string[] }> {
  if (isDemoModeEnabled()) return getDemoImapConfig()
  const row = await getRow()
  const [config] = normalizeImapServers(row)
  if (config) return config

  const host = row?.imapHost || env.IMAP_HOST || ''
  const user = row?.imapUser || env.IMAP_USER || ''
  const password = row?.imapPassword ? decryptSecret(row.imapPassword) : env.IMAP_PASSWORD || ''

  const missing: string[] = []
  if (!host) missing.push('IMAP Host')
  if (!user) missing.push('IMAP User')
  if (!password) missing.push('IMAP Password')
  if (missing.length > 0) return { missing }

  const portRaw = row?.imapPort ?? parseNumber(env.IMAP_PORT, 993)
  const secureRaw = row?.imapSecure ?? parseBoolean(env.IMAP_SECURE, true)

  return {
    id: 'primary',
    name: 'Primary',
    host,
    port: portRaw,
    secure: secureRaw,
    user,
    password,
    mailbox: row?.imapMailbox || env.IMAP_MAILBOX || 'INBOX',
    pollSeconds: row?.imapPollSeconds ?? parseNumber(env.IMAP_POLL_SECONDS, 15)
  }
}

export async function getSmtpConfig(): Promise<SmtpConfig | { missing: string[] }> {
  if (isDemoModeEnabled()) return getDemoSmtpConfig()
  const row = await getRow()
  const [config] = normalizeSmtpServers(row)
  if (config) return config

  const host = row?.smtpHost || env.SMTP_HOST || ''
  const user = row?.smtpUser || env.SMTP_USER || ''
  const password = row?.smtpPassword ? decryptSecret(row.smtpPassword) : env.SMTP_PASSWORD || ''

  const missing: string[] = []
  if (!host) missing.push('SMTP Host')
  if (!user) missing.push('SMTP User')
  if (!password) missing.push('SMTP Password')
  if (missing.length > 0) return { missing }

  const portRaw = row?.smtpPort ?? parseNumber(env.SMTP_PORT, 587)
  const secureRaw = row?.smtpSecure ?? parseBoolean(env.SMTP_SECURE, false)

  return {
    id: 'primary',
    name: 'Primary',
    host,
    port: portRaw,
    secure: secureRaw,
    user,
    password,
    from: row?.smtpFrom || env.SMTP_FROM || user
  }
}

export async function getImapConfigs(): Promise<ImapConfig[]> {
  const config = await getImapConfig()
  if (isDemoModeEnabled()) return 'missing' in config ? [] : [config]
  return normalizeImapServers(await getRow())
}

export async function getSmtpConfigs(): Promise<SmtpConfig[]> {
  const config = await getSmtpConfig()
  if (isDemoModeEnabled()) return 'missing' in config ? [] : [config]
  return normalizeSmtpServers(await getRow())
}

export async function getUndoSendSeconds(): Promise<number> {
  if (isDemoModeEnabled()) return getDemoDisplayConfig().smtp.undoSendSeconds
  const row = await getRow()
  return parseUndoSendSeconds(row?.smtpUndoSendSeconds ?? env.SMTP_UNDO_SEND_SECONDS ?? 0)
}

export async function getOidcConfig(): Promise<OidcConfig> {
  if (isDemoModeEnabled()) return getDemoOidcConfig()
  const row = await getRow()
  return {
    issuer: row?.oidcIssuer || env.OIDC_ISSUER || '',
    authorizationUrl: row?.oidcAuthorizationUrl || env.OIDC_AUTHORIZATION_URL || '',
    tokenUrl: row?.oidcTokenUrl || env.OIDC_TOKEN_URL || '',
    userInfoUrl: row?.oidcUserInfoUrl || env.OIDC_USER_INFO_URL || '',
    legacyDiscoveryUrl: row?.oidcDiscoveryUrl || env.OIDC_DISCOVERY_URL || '',
    clientId: row?.oidcClientId || env.OIDC_CLIENT_ID || '',
    clientSecret: row?.oidcClientSecret
      ? decryptSecret(row.oidcClientSecret)
      : env.OIDC_CLIENT_SECRET || ''
  }
}

export async function getAuthenticationConfig(): Promise<AuthenticationConfig> {
  if (isDemoModeEnabled()) {
    return {
      github: { clientId: '', clientSecret: '' },
      discord: { clientId: '', clientSecret: '' },
      oidc: getDemoOidcConfig()
    }
  }

  const row = await getRow()
  return {
    github: {
      clientId: row?.githubClientId || env.GITHUB_CLIENT_ID || '',
      clientSecret: row?.githubClientSecret
        ? decryptSecret(row.githubClientSecret)
        : env.GITHUB_CLIENT_SECRET || ''
    },
    discord: {
      clientId: row?.discordClientId || env.DISCORD_CLIENT_ID || '',
      clientSecret: row?.discordClientSecret
        ? decryptSecret(row.discordClientSecret)
        : env.DISCORD_CLIENT_SECRET || ''
    },
    oidc: await getOidcConfig()
  }
}

export function isOAuthClientConfigured(config: OAuthClientConfig): boolean {
  return Boolean(config.clientId && config.clientSecret)
}

export function isOidcConfigComplete(oidc: OidcConfig): boolean {
  if (!oidc.clientId || !oidc.clientSecret) return false
  const manualValues = [oidc.issuer, oidc.authorizationUrl, oidc.tokenUrl, oidc.userInfoUrl]
  return manualValues.some(Boolean) ? manualValues.every(Boolean) : Boolean(oidc.legacyDiscoveryUrl)
}

export async function isOidcConfigured(): Promise<boolean> {
  if (isDemoModeEnabled()) return true
  return isOidcConfigComplete(await getOidcConfig())
}

export async function isAuthenticationConfigured(): Promise<boolean> {
  if (isDemoModeEnabled()) return true
  const row = await getRow()
  if (row?.authSetupComplete || row?.authUserId) return true

  const auth = await getAuthenticationConfig()
  return (
    isOAuthClientConfigured(auth.github) ||
    isOAuthClientConfigured(auth.discord) ||
    isOidcConfigComplete(auth.oidc)
  )
}

export async function getSignature(): Promise<string> {
  if (isDemoModeEnabled()) return getDemoDisplayConfig().signature
  const [profile] = await db
    .select()
    .from(mailSignature)
    .orderBy(desc(mailSignature.isDefault), asc(mailSignature.id))
    .limit(1)
  if (profile) return profile.html
  const row = await getRow()
  return row?.signature ?? ''
}

export async function getSignatureProfiles(): Promise<MailSignatureRow[]> {
  if (isDemoModeEnabled()) return getDemoSignatureProfiles()
  return db.select().from(mailSignature).orderBy(asc(mailSignature.id))
}

export async function getQuietHoursConfig(): Promise<QuietHoursConfig> {
  if (isDemoModeEnabled()) return getDemoDisplayConfig().quietHours
  const row = await getRow()
  return {
    enabled: row?.quietHoursEnabled ?? DEFAULT_QUIET_HOURS.enabled,
    start: normalizeQuietHoursTime(row?.quietHoursStart, DEFAULT_QUIET_HOURS.start),
    end: normalizeQuietHoursTime(row?.quietHoursEnd, DEFAULT_QUIET_HOURS.end),
    timezone: normalizeQuietHoursTimezone(row?.quietHoursTimezone, DEFAULT_QUIET_HOURS.timezone)
  }
}

/** Returns the effective values shown in the settings UI (masks password). */
export async function getDisplayConfig() {
  if (isDemoModeEnabled()) return getDemoDisplayConfig()
  const row = await getRow()
  const signatureProfiles = await getSignatureProfiles()
  const quietHours = await getQuietHoursConfig()
  const imapServers = normalizeImapServers(row)
  const smtpServers = normalizeSmtpServers(row)
  const imapDisplay = imapServers[0]
    ? maskImap(imapServers[0], row?.imapHost || row?.imapServers ? 'db' : 'env')
    : {
        id: 'primary',
        name: 'Primary',
        host: row?.imapHost ?? env.IMAP_HOST ?? '',
        port: row?.imapPort ?? parseNumber(env.IMAP_PORT, 993),
        secure: row?.imapSecure ?? parseBoolean(env.IMAP_SECURE, true),
        user: row?.imapUser ?? env.IMAP_USER ?? '',
        password: row?.imapPassword ? '••••••••' : env.IMAP_PASSWORD ? '••••••••' : '',
        mailbox: row?.imapMailbox ?? env.IMAP_MAILBOX ?? 'INBOX',
        pollSeconds: row?.imapPollSeconds ?? parseNumber(env.IMAP_POLL_SECONDS, 15),
        source: row?.imapHost ? 'db' : 'env'
      }
  const smtpDisplay = smtpServers[0]
    ? {
        ...maskSmtp(smtpServers[0], row?.smtpHost || row?.smtpServers ? 'db' : 'env'),
        undoSendSeconds: parseUndoSendSeconds(
          row?.smtpUndoSendSeconds ?? env.SMTP_UNDO_SEND_SECONDS ?? 0
        )
      }
    : {
        id: 'primary',
        name: 'Primary',
        host: row?.smtpHost ?? env.SMTP_HOST ?? '',
        port: row?.smtpPort ?? parseNumber(env.SMTP_PORT, 587),
        secure: row?.smtpSecure ?? parseBoolean(env.SMTP_SECURE, false),
        user: row?.smtpUser ?? env.SMTP_USER ?? '',
        password: row?.smtpPassword ? '••••••••' : env.SMTP_PASSWORD ? '••••••••' : '',
        from: row?.smtpFrom ?? env.SMTP_FROM ?? '',
        undoSendSeconds: parseUndoSendSeconds(
          row?.smtpUndoSendSeconds ?? env.SMTP_UNDO_SEND_SECONDS ?? 0
        ),
        source: row?.smtpHost ? 'db' : 'env'
      }
  return {
    signature: row?.signature ?? '',
    signatureProfiles,
    imap: imapDisplay,
    imapServers: imapServers.map((config, index) =>
      maskImap(config, index === 0 && row?.imapHost ? 'db' : row?.imapServers ? 'db' : 'env')
    ),
    smtp: smtpDisplay,
    smtpServers: smtpServers.map((config, index) =>
      maskSmtp(config, index === 0 && row?.smtpHost ? 'db' : row?.smtpServers ? 'db' : 'env')
    ),
    oidc: {
      issuer: row?.oidcIssuer ?? env.OIDC_ISSUER ?? '',
      authorizationUrl: row?.oidcAuthorizationUrl ?? env.OIDC_AUTHORIZATION_URL ?? '',
      tokenUrl: row?.oidcTokenUrl ?? env.OIDC_TOKEN_URL ?? '',
      userInfoUrl: row?.oidcUserInfoUrl ?? env.OIDC_USER_INFO_URL ?? '',
      clientId: row?.oidcClientId ?? env.OIDC_CLIENT_ID ?? '',
      clientSecret: row?.oidcClientSecret ? '••••••••' : env.OIDC_CLIENT_SECRET ? '••••••••' : '',
      source:
        row?.oidcIssuer || row?.oidcAuthorizationUrl || row?.oidcClientId
          ? ('db' as const)
          : ('env' as const)
    },
    github: {
      clientId: row?.githubClientId ?? env.GITHUB_CLIENT_ID ?? '',
      clientSecret: row?.githubClientSecret
        ? '••••••••'
        : env.GITHUB_CLIENT_SECRET
          ? '••••••••'
          : '',
      source: row?.githubClientId ? ('db' as const) : ('env' as const)
    },
    discord: {
      clientId: row?.discordClientId ?? env.DISCORD_CLIENT_ID ?? '',
      clientSecret: row?.discordClientSecret
        ? '••••••••'
        : env.DISCORD_CLIENT_SECRET
          ? '••••••••'
          : '',
      source: row?.discordClientId ? ('db' as const) : ('env' as const)
    },
    secretStorage: getSecretStorageStatus(),
    quietHours
  }
}
