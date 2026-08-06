import { isValidThemeStyle, normalizeThemeStyle, type ThemeStyle } from '$lib/theme'
import { isShareAction, type ShareAction } from '$lib/share-action'

export const SETTINGS_BACKUP_SCHEMA_VERSION = 1

type BackupObject = Record<string, unknown>

export type SettingsBackup = {
  schemaVersion: typeof SETTINGS_BACKUP_SCHEMA_VERSION
  exportedAt: string
  app: 'mail'
  settings?: {
    imap?: {
      host?: string
      port?: number
      secure?: boolean
      allowInvalidCertificate?: boolean
      user?: string
      mailbox?: string
      pollSeconds?: number
    }
    imapServers?: Array<{
      id?: string
      name?: string
      host?: string
      port?: number
      secure?: boolean
      allowInvalidCertificate?: boolean
      user?: string
      mailbox?: string
      pollSeconds?: number
    }>
    smtp?: {
      host?: string
      port?: number
      secure?: boolean
      allowInvalidCertificate?: boolean
      user?: string
      from?: string
    }
    smtpServers?: Array<{
      id?: string
      name?: string
      host?: string
      port?: number
      secure?: boolean
      allowInvalidCertificate?: boolean
      user?: string
      from?: string
    }>
    oidc?: {
      /** @deprecated Legacy discovery-based backups remain importable. */
      discoveryUrl?: string
      issuer?: string
      authorizationUrl?: string
      tokenUrl?: string
      userInfoUrl?: string
      clientId?: string
    }
    github?: { clientId?: string }
    discord?: { clientId?: string }
    openai?: {
      model?: string
      importanceClassification?: boolean
    }
    signature?: string
  }
  preferences?: {
    simplifiedView?: boolean
    threadModeOnPageLoad?: boolean
    compactMode?: boolean
    themePreference?: 'light' | 'dark' | 'system'
    themeStyle?: ThemeStyle
    translationTargetLanguage?: string
    density?: 'comfortable' | 'compact' | 'condensed'
    shareClickAction?: ShareAction
    shareShiftClickAction?: ShareAction
    remoteContent?: { blockRemoteContent?: boolean; allowedSenders?: string[] }
    mailboxPreferences?: { order?: string[]; hidden?: string[]; collapsedAccounts?: string[] }
    listRatio?: number
    sidebarWidth?: number
    defaultMailbox?: string
  }
  filters?: Array<{
    field: string
    operator: string
    value: string
    action: string
    target: string | null
    enabled: boolean
    sortOrder: number
  }>
  savedSearches?: Array<{
    name: string
    query: string
  }>
}

export type SettingsRestoreSelection = {
  settings: boolean
  preferences: boolean
  filters: boolean
  savedSearches: boolean
}

export const DEFAULT_SETTINGS_RESTORE_SELECTION: SettingsRestoreSelection = {
  settings: true,
  preferences: true,
  filters: true,
  savedSearches: true
}

const ALLOWED_FILTER_FIELDS = new Set(['from', 'to', 'subject', 'cc'])
const ALLOWED_FILTER_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with'])
const ALLOWED_FILTER_ACTIONS = new Set(['mark_read', 'trash', 'move'])
const MAX_BACKUP_STRING_LENGTH = 10_000

function optionalObjectArray(
  value: unknown,
  field: string,
  errors: string[]
): BackupObject[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`)
    return undefined
  }
  return value.flatMap((item, index) => {
    if (!isObject(item)) {
      errors.push(`${field}[${index}] must be an object`)
      return []
    }
    return [item]
  })
}

function isObject(value: unknown): value is BackupObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown, field: string, errors: string[]): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`)
    return undefined
  }
  if (value.length > MAX_BACKUP_STRING_LENGTH) {
    errors.push(`${field} is too long`)
    return undefined
  }
  return value
}

function optionalNumber(value: unknown, field: string, errors: string[]): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be a positive number`)
    return undefined
  }
  return Math.trunc(value)
}

function optionalNonNegativeNumber(
  value: unknown,
  field: string,
  errors: string[]
): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${field} must be a non-negative number`)
    return undefined
  }
  return Math.trunc(value)
}

function optionalBoolean(value: unknown, field: string, errors: string[]): boolean | undefined {
  if (value == null) return undefined
  if (typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean`)
    return undefined
  }
  return value
}

function optionalObject(value: unknown, field: string, errors: string[]): BackupObject | undefined {
  if (value == null) return undefined
  if (!isObject(value)) {
    errors.push(`${field} must be an object`)
    return undefined
  }
  return value
}

export function normalizeRestoreSelection(value: unknown): SettingsRestoreSelection {
  if (!isObject(value)) return DEFAULT_SETTINGS_RESTORE_SELECTION
  return {
    settings: typeof value.settings === 'boolean' ? value.settings : true,
    preferences: typeof value.preferences === 'boolean' ? value.preferences : true,
    filters: typeof value.filters === 'boolean' ? value.filters : true,
    savedSearches: typeof value.savedSearches === 'boolean' ? value.savedSearches : true
  }
}

export function validateSettingsBackup(value: unknown): {
  backup?: SettingsBackup
  errors: string[]
} {
  const errors: string[] = []
  if (!isObject(value)) return { errors: ['Backup must be a JSON object'] }

  if (value.schemaVersion !== SETTINGS_BACKUP_SCHEMA_VERSION) {
    return {
      errors: [`Unsupported settings backup schema version: ${String(value.schemaVersion)}`]
    }
  }

  if (value.app !== 'mail') errors.push('Backup app must be mail')

  const exportedAt =
    optionalString(value.exportedAt, 'exportedAt', errors) ?? new Date().toISOString()
  const settingsObject = optionalObject(value.settings, 'settings', errors)
  const preferencesObject = optionalObject(value.preferences, 'preferences', errors)
  const backup: SettingsBackup = {
    schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
    exportedAt,
    app: 'mail'
  }

  if (settingsObject) {
    const settings: NonNullable<SettingsBackup['settings']> = {}
    const imapObject = optionalObject(settingsObject.imap, 'settings.imap', errors)
    const imapServers = optionalObjectArray(
      settingsObject.imapServers,
      'settings.imapServers',
      errors
    )
    const smtpObject = optionalObject(settingsObject.smtp, 'settings.smtp', errors)
    const smtpServers = optionalObjectArray(
      settingsObject.smtpServers,
      'settings.smtpServers',
      errors
    )
    const oidcObject = optionalObject(settingsObject.oidc, 'settings.oidc', errors)
    const githubObject = optionalObject(settingsObject.github, 'settings.github', errors)
    const discordObject = optionalObject(settingsObject.discord, 'settings.discord', errors)
    const openaiObject = optionalObject(settingsObject.openai, 'settings.openai', errors)

    if (imapObject) {
      settings.imap = {
        host: optionalString(imapObject.host, 'settings.imap.host', errors),
        port: optionalNumber(imapObject.port, 'settings.imap.port', errors),
        secure: optionalBoolean(imapObject.secure, 'settings.imap.secure', errors),
        allowInvalidCertificate: optionalBoolean(
          imapObject.allowInvalidCertificate,
          'settings.imap.allowInvalidCertificate',
          errors
        ),
        user: optionalString(imapObject.user, 'settings.imap.user', errors),
        mailbox: optionalString(imapObject.mailbox, 'settings.imap.mailbox', errors),
        pollSeconds: optionalNumber(imapObject.pollSeconds, 'settings.imap.pollSeconds', errors)
      }
    }

    if (imapServers) {
      settings.imapServers = imapServers.map((server, index) => ({
        id: optionalString(server.id, `settings.imapServers[${index}].id`, errors),
        name: optionalString(server.name, `settings.imapServers[${index}].name`, errors),
        host: optionalString(server.host, `settings.imapServers[${index}].host`, errors),
        port: optionalNumber(server.port, `settings.imapServers[${index}].port`, errors),
        secure: optionalBoolean(server.secure, `settings.imapServers[${index}].secure`, errors),
        allowInvalidCertificate: optionalBoolean(
          server.allowInvalidCertificate,
          `settings.imapServers[${index}].allowInvalidCertificate`,
          errors
        ),
        user: optionalString(server.user, `settings.imapServers[${index}].user`, errors),
        mailbox: optionalString(server.mailbox, `settings.imapServers[${index}].mailbox`, errors),
        pollSeconds: optionalNumber(
          server.pollSeconds,
          `settings.imapServers[${index}].pollSeconds`,
          errors
        )
      }))
    }

    if (smtpObject) {
      settings.smtp = {
        host: optionalString(smtpObject.host, 'settings.smtp.host', errors),
        port: optionalNumber(smtpObject.port, 'settings.smtp.port', errors),
        secure: optionalBoolean(smtpObject.secure, 'settings.smtp.secure', errors),
        allowInvalidCertificate: optionalBoolean(
          smtpObject.allowInvalidCertificate,
          'settings.smtp.allowInvalidCertificate',
          errors
        ),
        user: optionalString(smtpObject.user, 'settings.smtp.user', errors),
        from: optionalString(smtpObject.from, 'settings.smtp.from', errors)
      }
    }

    if (smtpServers) {
      settings.smtpServers = smtpServers.map((server, index) => ({
        id: optionalString(server.id, `settings.smtpServers[${index}].id`, errors),
        name: optionalString(server.name, `settings.smtpServers[${index}].name`, errors),
        host: optionalString(server.host, `settings.smtpServers[${index}].host`, errors),
        port: optionalNumber(server.port, `settings.smtpServers[${index}].port`, errors),
        secure: optionalBoolean(server.secure, `settings.smtpServers[${index}].secure`, errors),
        allowInvalidCertificate: optionalBoolean(
          server.allowInvalidCertificate,
          `settings.smtpServers[${index}].allowInvalidCertificate`,
          errors
        ),
        user: optionalString(server.user, `settings.smtpServers[${index}].user`, errors),
        from: optionalString(server.from, `settings.smtpServers[${index}].from`, errors)
      }))
    }

    if (oidcObject) {
      settings.oidc = {
        discoveryUrl: optionalString(oidcObject.discoveryUrl, 'settings.oidc.discoveryUrl', errors),
        issuer: optionalString(oidcObject.issuer, 'settings.oidc.issuer', errors),
        authorizationUrl: optionalString(
          oidcObject.authorizationUrl,
          'settings.oidc.authorizationUrl',
          errors
        ),
        tokenUrl: optionalString(oidcObject.tokenUrl, 'settings.oidc.tokenUrl', errors),
        userInfoUrl: optionalString(oidcObject.userInfoUrl, 'settings.oidc.userInfoUrl', errors),
        clientId: optionalString(oidcObject.clientId, 'settings.oidc.clientId', errors)
      }
    }

    if (githubObject) {
      settings.github = {
        clientId: optionalString(githubObject.clientId, 'settings.github.clientId', errors)
      }
    }

    if (discordObject) {
      settings.discord = {
        clientId: optionalString(discordObject.clientId, 'settings.discord.clientId', errors)
      }
    }

    if (openaiObject) {
      settings.openai = {
        model: optionalString(openaiObject.model, 'settings.openai.model', errors),
        importanceClassification: optionalBoolean(
          openaiObject.importanceClassification,
          'settings.openai.importanceClassification',
          errors
        )
      }
    }

    settings.signature = optionalString(settingsObject.signature, 'settings.signature', errors)
    backup.settings = settings
  }

  if (preferencesObject) {
    const themePreference = optionalString(
      preferencesObject.themePreference,
      'preferences.themePreference',
      errors
    )
    if (themePreference != null && !['light', 'dark', 'system'].includes(themePreference)) {
      errors.push('preferences.themePreference is invalid')
    }
    const themeStyle = optionalObject(
      preferencesObject.themeStyle,
      'preferences.themeStyle',
      errors
    )
    if (themeStyle && !isValidThemeStyle(themeStyle)) {
      errors.push('preferences.themeStyle is invalid')
    }
    const shareClickAction = optionalString(
      preferencesObject.shareClickAction,
      'preferences.shareClickAction',
      errors
    )
    if (shareClickAction != null && !isShareAction(shareClickAction)) {
      errors.push('preferences.shareClickAction is invalid')
    }
    const shareShiftClickAction = optionalString(
      preferencesObject.shareShiftClickAction,
      'preferences.shareShiftClickAction',
      errors
    )
    if (shareShiftClickAction != null && !isShareAction(shareShiftClickAction)) {
      errors.push('preferences.shareShiftClickAction is invalid')
    }
    backup.preferences = {
      simplifiedView: optionalBoolean(
        preferencesObject.simplifiedView,
        'preferences.simplifiedView',
        errors
      ),
      threadModeOnPageLoad: optionalBoolean(
        preferencesObject.threadModeOnPageLoad,
        'preferences.threadModeOnPageLoad',
        errors
      ),
      compactMode: optionalBoolean(
        preferencesObject.compactMode,
        'preferences.compactMode',
        errors
      ),
      themePreference:
        themePreference === 'light' || themePreference === 'dark' || themePreference === 'system'
          ? themePreference
          : undefined,
      themeStyle:
        themeStyle && isValidThemeStyle(themeStyle) ? normalizeThemeStyle(themeStyle) : undefined,
      translationTargetLanguage: optionalString(
        preferencesObject.translationTargetLanguage,
        'preferences.translationTargetLanguage',
        errors
      ),
      density: ['comfortable', 'compact', 'condensed'].includes(String(preferencesObject.density))
        ? (preferencesObject.density as 'comfortable' | 'compact' | 'condensed')
        : undefined,
      shareClickAction: isShareAction(shareClickAction) ? shareClickAction : undefined,
      shareShiftClickAction: isShareAction(shareShiftClickAction)
        ? shareShiftClickAction
        : undefined,
      remoteContent: optionalObject(
        preferencesObject.remoteContent,
        'preferences.remoteContent',
        errors
      ) as NonNullable<SettingsBackup['preferences']>['remoteContent'],
      mailboxPreferences: optionalObject(
        preferencesObject.mailboxPreferences,
        'preferences.mailboxPreferences',
        errors
      ) as NonNullable<SettingsBackup['preferences']>['mailboxPreferences'],
      listRatio: optionalNumber(preferencesObject.listRatio, 'preferences.listRatio', errors),
      sidebarWidth: optionalNumber(
        preferencesObject.sidebarWidth,
        'preferences.sidebarWidth',
        errors
      ),
      defaultMailbox: optionalString(
        preferencesObject.defaultMailbox,
        'preferences.defaultMailbox',
        errors
      )
    }
  }

  if (value.filters != null) {
    if (!Array.isArray(value.filters)) {
      errors.push('filters must be an array')
    } else {
      backup.filters = value.filters.flatMap((filter, index) => {
        if (!isObject(filter)) {
          errors.push(`filters[${index}] must be an object`)
          return []
        }

        const field = optionalString(filter.field, `filters[${index}].field`, errors) ?? ''
        const operator = optionalString(filter.operator, `filters[${index}].operator`, errors) ?? ''
        const action = optionalString(filter.action, `filters[${index}].action`, errors) ?? ''
        const target =
          filter.target == null
            ? null
            : optionalString(filter.target, `filters[${index}].target`, errors)
        const value = optionalString(filter.value, `filters[${index}].value`, errors) ?? ''

        if (!ALLOWED_FILTER_FIELDS.has(field)) errors.push(`filters[${index}].field is invalid`)
        if (!ALLOWED_FILTER_OPERATORS.has(operator)) {
          errors.push(`filters[${index}].operator is invalid`)
        }
        if (!ALLOWED_FILTER_ACTIONS.has(action)) errors.push(`filters[${index}].action is invalid`)
        if (action === 'move' && !target)
          errors.push(`filters[${index}].target is required for move`)

        return [
          {
            field,
            operator,
            value,
            action,
            target: target ?? null,
            enabled: optionalBoolean(filter.enabled, `filters[${index}].enabled`, errors) ?? true,
            sortOrder:
              optionalNonNegativeNumber(filter.sortOrder, `filters[${index}].sortOrder`, errors) ??
              index
          }
        ]
      })
    }
  }

  if (value.savedSearches != null) {
    if (!Array.isArray(value.savedSearches)) {
      errors.push('savedSearches must be an array')
    } else {
      backup.savedSearches = value.savedSearches.flatMap((search, index) => {
        if (!isObject(search)) {
          errors.push(`savedSearches[${index}] must be an object`)
          return []
        }
        const name =
          optionalString(search.name, `savedSearches[${index}].name`, errors)?.trim() ?? ''
        const query =
          optionalString(search.query, `savedSearches[${index}].query`, errors)?.trim() ?? ''
        if (!name) errors.push(`savedSearches[${index}].name is required`)
        if (!query) errors.push(`savedSearches[${index}].query is required`)
        return [{ name, query }]
      })
    }
  }

  return errors.length > 0 ? { errors } : { backup, errors }
}
