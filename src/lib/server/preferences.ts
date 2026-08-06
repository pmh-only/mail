import { db } from '$lib/server/db'
import { mailConfig } from '$lib/server/db/schema'
import { isDemoModeEnabled } from '$lib/server/demo'
import { DEFAULT_LIST_RATIO, clampRatio } from '$lib/list-width'
import { normalizeThemeStyle, type ThemeStyle } from '$lib/theme'
import {
  DEFAULT_SHARE_CLICK_ACTION,
  DEFAULT_SHARE_SHIFT_CLICK_ACTION,
  normalizeShareAction,
  type ShareAction
} from '$lib/share-action'
import {
  mergeMailboxPreferences,
  normalizeMailboxPreferences,
  type MailboxPreferences
} from '$lib/mailbox-preferences'
import { sql } from 'drizzle-orm'

const DEFAULT_TRANSLATION_TARGET_LANGUAGE = 'Korean'
export const DEFAULT_MAILBOX = 'inbox'
export const DENSITY_VALUES = ['comfortable', 'compact', 'condensed'] as const
export type DensityPreference = (typeof DENSITY_VALUES)[number]

export type ThemePreference = 'light' | 'dark' | 'system'
export type { MailboxPreferences } from '$lib/mailbox-preferences'

export type Preferences = {
  simplifiedView: boolean
  threadModeOnPageLoad: boolean
  density: DensityPreference
  shareClickAction: ShareAction
  shareShiftClickAction: ShareAction
  themePreference: ThemePreference
  themeStyle: ThemeStyle
  translationTargetLanguage: string
  remoteContent: { blockRemoteContent: boolean; allowedSenders: string[] }
  mailboxPreferences: MailboxPreferences
  listRatio: number
  sidebarWidth: number
  defaultMailbox: string
}

let demoPreferences: Preferences | undefined

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function normalizeTranslationTargetLanguage(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  return normalized || DEFAULT_TRANSLATION_TARGET_LANGUAGE
}

export function normalizeDensityPreference(value: unknown): DensityPreference | null {
  return typeof value === 'string' && DENSITY_VALUES.includes(value as DensityPreference)
    ? (value as DensityPreference)
    : null
}

export function normalizeDefaultMailbox(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 80) : ''
  return normalized || DEFAULT_MAILBOX
}

export function normalizeRemoteContentAllowedSenders(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : []
  return Array.from(
    new Set(values.map((item) => item.trim().toLowerCase()).filter((item) => item.includes('@')))
  ).sort()
}

export function normalizePreferences(value: unknown): Preferences {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const density = normalizeDensityPreference(record.density) ?? 'comfortable'
  const remoteContent =
    record.remoteContent && typeof record.remoteContent === 'object'
      ? (record.remoteContent as Record<string, unknown>)
      : {}
  return {
    simplifiedView: record.simplifiedView !== false,
    threadModeOnPageLoad: record.threadModeOnPageLoad !== false,
    density,
    shareClickAction: normalizeShareAction(record.shareClickAction, DEFAULT_SHARE_CLICK_ACTION),
    shareShiftClickAction: normalizeShareAction(
      record.shareShiftClickAction,
      DEFAULT_SHARE_SHIFT_CLICK_ACTION
    ),
    themePreference: normalizeThemePreference(record.themePreference),
    themeStyle: normalizeThemeStyle(record.themeStyle),
    translationTargetLanguage: normalizeTranslationTargetLanguage(record.translationTargetLanguage),
    remoteContent: {
      blockRemoteContent: remoteContent.blockRemoteContent !== false,
      allowedSenders: normalizeRemoteContentAllowedSenders(remoteContent.allowedSenders)
    },
    mailboxPreferences: normalizeMailboxPreferences(record.mailboxPreferences),
    listRatio: clampRatio(
      typeof record.listRatio === 'number' ? record.listRatio : DEFAULT_LIST_RATIO
    ),
    sidebarWidth: Math.min(
      400,
      Math.max(150, typeof record.sidebarWidth === 'number' ? record.sidebarWidth : 260)
    ),
    defaultMailbox: normalizeDefaultMailbox(record.defaultMailbox)
  }
}

export async function getStoredPreferences(): Promise<Preferences> {
  if (isDemoModeEnabled()) return demoPreferences ?? normalizePreferences(null)

  const [config] = await db
    .select({ preferences: mailConfig.preferences })
    .from(mailConfig)
    .limit(1)
  return normalizePreferences(config?.preferences)
}

export async function updateStoredPreferences(value: unknown): Promise<Preferences> {
  const patch = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const merge = (current: Preferences) => {
    const remoteContent =
      patch.remoteContent && typeof patch.remoteContent === 'object'
        ? (patch.remoteContent as Record<string, unknown>)
        : {}
    const mailboxPreferences = mergeMailboxPreferences(
      current.mailboxPreferences,
      patch.mailboxPreferences
    )
    return normalizePreferences({
      ...current,
      ...patch,
      density:
        normalizeDensityPreference(patch.density) ??
        (typeof patch.compactMode === 'boolean'
          ? patch.compactMode
            ? 'compact'
            : 'comfortable'
          : current.density),
      remoteContent: { ...current.remoteContent, ...remoteContent },
      mailboxPreferences
    })
  }

  if (isDemoModeEnabled()) {
    demoPreferences = merge(await getStoredPreferences())
    return demoPreferences
  }

  return db.transaction(async (tx) => {
    // Preference writes are partial JSON patches, so serialize them to avoid lost updates.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mail_preferences'))`)
    const [config] = await tx
      .select({ preferences: mailConfig.preferences })
      .from(mailConfig)
      .limit(1)
    const merged = merge(normalizePreferences(config?.preferences))
    await tx
      .insert(mailConfig)
      .values({ id: 1, preferences: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: mailConfig.id,
        set: { preferences: merged, updatedAt: new Date() }
      })
    return merged
  })
}

export function applyMailboxPreferences<T extends { path: string }>(
  mailboxes: T[],
  preferences: MailboxPreferences
) {
  const hidden = new Set(preferences.hidden)
  const order = new Map(preferences.order.map((path, index) => [path, index]))

  return mailboxes
    .filter((mailbox) => !hidden.has(mailbox.path))
    .sort((left, right) => {
      const leftOrder = order.get(left.path) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = order.get(right.path) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return 0
    })
}
