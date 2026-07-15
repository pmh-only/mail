import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { asc } from 'drizzle-orm'
import { db } from '$lib/server/db'
import { mailConfig, mailFilter, savedSearch } from '$lib/server/db/schema'
import { invalidateAuth } from '$lib/server/auth'
import { getDisplayConfig, getOidcConfig, invalidateConfigCache } from '$lib/server/config'
import {
  getCompactModeEnabled,
  getSimplifiedViewEnabled,
  getThreadModeOnPageLoadEnabled,
  getTranslationTargetLanguage,
  setCompactModeEnabled,
  setSimplifiedViewEnabled,
  setThreadModeOnPageLoadEnabled,
  setTranslationTargetLanguage
} from '$lib/server/preferences'
import {
  DEFAULT_SETTINGS_RESTORE_SELECTION,
  SETTINGS_BACKUP_SCHEMA_VERSION,
  normalizeRestoreSelection,
  validateSettingsBackup
} from '$lib/server/settings-backup'
import { isDemoModeEnabled, listDemoFilters } from '$lib/server/demo'

function exportMailServer(server: Record<string, unknown>) {
  const exported = { ...server }
  delete exported.password
  delete exported.source
  return exported
}

export const GET: RequestHandler = async ({ cookies }) => {
  const config = await getDisplayConfig()
  const imapServers = config.imapServers
  const smtpServers = config.smtpServers
  const filters = isDemoModeEnabled()
    ? listDemoFilters()
    : await db.select().from(mailFilter).orderBy(asc(mailFilter.sortOrder))
  const searches = isDemoModeEnabled()
    ? []
    : await db.select().from(savedSearch).orderBy(asc(savedSearch.name))

  return json({
    schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'mail',
    settings: {
      imap: {
        host: config.imap.host,
        port: config.imap.port,
        secure: config.imap.secure,
        user: config.imap.user,
        mailbox: config.imap.mailbox,
        pollSeconds: config.imap.pollSeconds
      },
      imapServers: imapServers.map(exportMailServer),
      smtp: {
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        user: config.smtp.user,
        from: config.smtp.from
      },
      smtpServers: smtpServers.map(exportMailServer),
      oidc: {
        discoveryUrl: config.oidc.discoveryUrl,
        clientId: config.oidc.clientId
      },
      signature: config.signature
    },
    preferences: {
      simplifiedView: getSimplifiedViewEnabled(cookies),
      threadModeOnPageLoad: getThreadModeOnPageLoadEnabled(cookies),
      compactMode: getCompactModeEnabled(cookies),
      translationTargetLanguage: getTranslationTargetLanguage(cookies)
    },
    filters: filters.map((filter) => ({
      field: filter.field,
      operator: filter.operator,
      value: filter.value,
      action: filter.action,
      target: filter.target,
      enabled: filter.enabled,
      sortOrder: filter.sortOrder
    })),
    savedSearches: searches.map((search) => ({
      name: search.name,
      query: search.query
    }))
  })
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return error(400, 'Request body must be a JSON object')
  }

  const selection = normalizeRestoreSelection(body.restore ?? DEFAULT_SETTINGS_RESTORE_SELECTION)
  const { backup, errors } = validateSettingsBackup(body.backup)

  if (!backup) return error(400, errors.join('\n'))

  if (isDemoModeEnabled()) {
    if (selection.preferences && backup.preferences) {
      if (backup.preferences.simplifiedView != null) {
        setSimplifiedViewEnabled(cookies, backup.preferences.simplifiedView)
      }
      if (backup.preferences.threadModeOnPageLoad != null) {
        setThreadModeOnPageLoadEnabled(cookies, backup.preferences.threadModeOnPageLoad)
      }
      if (backup.preferences.compactMode != null) {
        setCompactModeEnabled(cookies, backup.preferences.compactMode)
      }
      if (backup.preferences.translationTargetLanguage != null) {
        setTranslationTargetLanguage(cookies, backup.preferences.translationTargetLanguage)
      }
    }

    return json({ success: true, restored: selection })
  }

  let restoredSettings = false

  if (selection.settings && backup.settings) {
    const currentOidc = await getOidcConfig()
    const values: typeof mailConfig.$inferInsert = {
      id: 1,
      updatedAt: new Date()
    }

    if (backup.settings.imap) {
      values.imapHost = backup.settings.imap.host?.trim() || null
      values.imapPort = backup.settings.imap.port ?? null
      values.imapSecure = backup.settings.imap.secure ?? null
      values.imapUser = backup.settings.imap.user?.trim() || null
      values.imapMailbox = backup.settings.imap.mailbox?.trim() || null
      values.imapPollSeconds = backup.settings.imap.pollSeconds ?? null
    }

    if (backup.settings.imapServers) {
      values.imapServers = backup.settings.imapServers
    }

    if (backup.settings.smtp) {
      values.smtpHost = backup.settings.smtp.host?.trim() || null
      values.smtpPort = backup.settings.smtp.port ?? null
      values.smtpSecure = backup.settings.smtp.secure ?? null
      values.smtpUser = backup.settings.smtp.user?.trim() || null
      values.smtpFrom = backup.settings.smtp.from?.trim() || null
    }

    if (backup.settings.smtpServers) {
      values.smtpServers = backup.settings.smtpServers
    }

    if (backup.settings.oidc) {
      const discoveryUrl = backup.settings.oidc.discoveryUrl?.trim() || ''
      values.oidcDiscoveryUrl = discoveryUrl || null
      values.oidcClientId = backup.settings.oidc.clientId?.trim() || null
      const nextDiscoveryUrl = discoveryUrl || env.OIDC_DISCOVERY_URL || ''
      if (nextDiscoveryUrl !== currentOidc.discoveryUrl) values.oidcSubject = null
    }

    if (backup.settings.signature != null) values.signature = backup.settings.signature

    await db.insert(mailConfig).values(values).onConflictDoUpdate({
      target: mailConfig.id,
      set: values
    })
    restoredSettings = true
  }

  if (selection.preferences && backup.preferences) {
    if (backup.preferences.simplifiedView != null) {
      setSimplifiedViewEnabled(cookies, backup.preferences.simplifiedView)
    }
    if (backup.preferences.threadModeOnPageLoad != null) {
      setThreadModeOnPageLoadEnabled(cookies, backup.preferences.threadModeOnPageLoad)
    }
    if (backup.preferences.compactMode != null) {
      setCompactModeEnabled(cookies, backup.preferences.compactMode)
    }
    if (backup.preferences.translationTargetLanguage != null) {
      setTranslationTargetLanguage(cookies, backup.preferences.translationTargetLanguage)
    }
  }

  if (selection.filters && backup.filters) {
    await db.delete(mailFilter)
    if (backup.filters.length > 0) {
      await db.insert(mailFilter).values(
        backup.filters.map((filter, index) => ({
          field: filter.field,
          operator: filter.operator,
          value: filter.value,
          action: filter.action,
          target: filter.target,
          enabled: filter.enabled,
          sortOrder: filter.sortOrder ?? index
        }))
      )
    }
  }

  if (selection.savedSearches && backup.savedSearches) {
    await db.delete(savedSearch)
    if (backup.savedSearches.length > 0) {
      await db.insert(savedSearch).values(backup.savedSearches)
    }
  }

  if (restoredSettings) {
    invalidateConfigCache()
    invalidateAuth()
  }

  return json({ success: true, restored: selection })
}
