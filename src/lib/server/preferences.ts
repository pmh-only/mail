import type { Cookies } from '@sveltejs/kit'

const SIMPLIFIED_VIEW_COOKIE = 'mail_simplified_view'
const COMPACT_MODE_COOKIE = 'mail_compact_mode'
const TRANSLATION_TARGET_LANGUAGE_COOKIE = 'mail_translation_target_language'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = 'Korean'

function normalizeTranslationTargetLanguage(value: string | null | undefined) {
  const normalized = value?.trim()?.slice(0, 80)
  return normalized || DEFAULT_TRANSLATION_TARGET_LANGUAGE
}

export function getSimplifiedViewEnabled(cookies: Pick<Cookies, 'get'>) {
  return cookies.get(SIMPLIFIED_VIEW_COOKIE) !== '0'
}

export function setSimplifiedViewEnabled(cookies: Pick<Cookies, 'set'>, enabled: boolean) {
  cookies.set(SIMPLIFIED_VIEW_COOKIE, enabled ? '1' : '0', {
    path: '/',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS
  })
}

export function getCompactModeEnabled(cookies: Pick<Cookies, 'get'>) {
  return cookies.get(COMPACT_MODE_COOKIE) === '1'
}

export function setCompactModeEnabled(cookies: Pick<Cookies, 'set'>, enabled: boolean) {
  cookies.set(COMPACT_MODE_COOKIE, enabled ? '1' : '0', {
    path: '/',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS
  })
}

export function getTranslationTargetLanguage(cookies: Pick<Cookies, 'get'>) {
  return normalizeTranslationTargetLanguage(cookies.get(TRANSLATION_TARGET_LANGUAGE_COOKIE))
}

export function setTranslationTargetLanguage(cookies: Pick<Cookies, 'set'>, value: string) {
  cookies.set(TRANSLATION_TARGET_LANGUAGE_COOKIE, normalizeTranslationTargetLanguage(value), {
    path: '/',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS
  })
}
