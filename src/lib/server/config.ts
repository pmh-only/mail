/**
 * Mail configuration loader.
 * DB values (mail_config table, id=1) take priority over environment variables.
 */
import { env } from '$env/dynamic/private'
import { db } from './db'
import { mailConfig } from './db/schema'
import { eq } from 'drizzle-orm'
import {
  getDemoDisplayConfig,
  getDemoImapConfig,
  getDemoOidcConfig,
  getDemoSmtpConfig,
  isDemoModeEnabled
} from './demo'

export type ImapConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  mailbox: string
  pollSeconds: number
}

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export type OidcConfig = {
  discoveryUrl: string
  clientId: string
  clientSecret: string
}

export type MailConfigRow = typeof mailConfig.$inferSelect

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return value.toLowerCase() !== 'false'
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

let cachedRow: MailConfigRow | null | undefined = undefined // undefined = not loaded yet

async function loadConfigRow(): Promise<MailConfigRow | null> {
  const [row] = await db.select().from(mailConfig).where(eq(mailConfig.id, 1)).limit(1)
  cachedRow = row ?? null
  return cachedRow ?? null
}

/** Call after saving settings to bust the cache. */
export function invalidateConfigCache() {
  cachedRow = undefined
}

async function getRow(): Promise<MailConfigRow | null> {
  if (isDemoModeEnabled()) return null
  if (cachedRow !== undefined) return cachedRow
  return loadConfigRow()
}

export async function getImapConfig(): Promise<ImapConfig | { missing: string[] }> {
  if (isDemoModeEnabled()) return getDemoImapConfig()
  const row = await getRow()

  const host = row?.imapHost || env.IMAP_HOST || ''
  const user = row?.imapUser || env.IMAP_USER || ''
  const password = row?.imapPassword || env.IMAP_PASSWORD || ''

  const missing: string[] = []
  if (!host) missing.push('IMAP Host')
  if (!user) missing.push('IMAP User')
  if (!password) missing.push('IMAP Password')
  if (missing.length > 0) return { missing }

  const portRaw = row?.imapPort ?? parseNumber(env.IMAP_PORT, 993)
  const secureRaw = row?.imapSecure ?? parseBoolean(env.IMAP_SECURE, true)

  return {
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

  const host = row?.smtpHost || env.SMTP_HOST || ''
  const user = row?.smtpUser || env.SMTP_USER || ''
  const password = row?.smtpPassword || env.SMTP_PASSWORD || ''

  const missing: string[] = []
  if (!host) missing.push('SMTP Host')
  if (!user) missing.push('SMTP User')
  if (!password) missing.push('SMTP Password')
  if (missing.length > 0) return { missing }

  const portRaw = row?.smtpPort ?? parseNumber(env.SMTP_PORT, 587)
  const secureRaw = row?.smtpSecure ?? parseBoolean(env.SMTP_SECURE, false)

  return {
    host,
    port: portRaw,
    secure: secureRaw,
    user,
    password,
    from: row?.smtpFrom || env.SMTP_FROM || user
  }
}

export async function getOidcConfig(): Promise<OidcConfig> {
  if (isDemoModeEnabled()) return getDemoOidcConfig()
  const row = await getRow()
  return {
    discoveryUrl: row?.oidcDiscoveryUrl || env.OIDC_DISCOVERY_URL || '',
    clientId: row?.oidcClientId || env.OIDC_CLIENT_ID || '',
    clientSecret: row?.oidcClientSecret || env.OIDC_CLIENT_SECRET || ''
  }
}

export async function isOidcConfigured(): Promise<boolean> {
  if (isDemoModeEnabled()) return true
  const oidc = await getOidcConfig()
  return !!(oidc.discoveryUrl && oidc.clientId && oidc.clientSecret)
}

export async function getSignature(): Promise<string> {
  if (isDemoModeEnabled()) return getDemoDisplayConfig().signature
  const row = await getRow()
  return row?.signature ?? ''
}

/** Returns the effective values shown in the settings UI (masks password). */
export async function getDisplayConfig() {
  if (isDemoModeEnabled()) return getDemoDisplayConfig()
  const row = await getRow()
  return {
    signature: row?.signature ?? '',
    imap: {
      host: row?.imapHost ?? env.IMAP_HOST ?? '',
      port: row?.imapPort ?? parseNumber(env.IMAP_PORT, 993),
      secure: row?.imapSecure ?? parseBoolean(env.IMAP_SECURE, true),
      user: row?.imapUser ?? env.IMAP_USER ?? '',
      password: row?.imapPassword ? '••••••••' : env.IMAP_PASSWORD ? '••••••••' : '',
      mailbox: row?.imapMailbox ?? env.IMAP_MAILBOX ?? 'INBOX',
      pollSeconds: row?.imapPollSeconds ?? parseNumber(env.IMAP_POLL_SECONDS, 15),
      // Where the value comes from — useful for UI hints
      source: row?.imapHost ? 'db' : 'env'
    },
    smtp: {
      host: row?.smtpHost ?? env.SMTP_HOST ?? '',
      port: row?.smtpPort ?? parseNumber(env.SMTP_PORT, 587),
      secure: row?.smtpSecure ?? parseBoolean(env.SMTP_SECURE, false),
      user: row?.smtpUser ?? env.SMTP_USER ?? '',
      password: row?.smtpPassword ? '••••••••' : env.SMTP_PASSWORD ? '••••••••' : '',
      from: row?.smtpFrom ?? env.SMTP_FROM ?? '',
      source: row?.smtpHost ? 'db' : 'env'
    },
    oidc: {
      discoveryUrl: row?.oidcDiscoveryUrl ?? env.OIDC_DISCOVERY_URL ?? '',
      clientId: row?.oidcClientId ?? env.OIDC_CLIENT_ID ?? '',
      clientSecret: row?.oidcClientSecret ? '••••••••' : env.OIDC_CLIENT_SECRET ? '••••••••' : '',
      source: row?.oidcDiscoveryUrl || row?.oidcClientId ? 'db' : 'env'
    }
  }
}
