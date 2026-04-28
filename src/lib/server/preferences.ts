import type { Cookies } from '@sveltejs/kit'

const SIMPLIFIED_VIEW_COOKIE = 'mail_simplified_view'
const COMPACT_MODE_COOKIE = 'mail_compact_mode'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

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
