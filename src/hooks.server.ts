import type { Handle } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { building } from '$app/environment'
import { getAuth } from '$lib/server/auth'
import { isOidcConfigured } from '$lib/server/config'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { startMailboxSync } from '$lib/server/mail'

// Warm up eagerly so the first request doesn't pay initialization costs
if (!building) {
  // Prevent connection errors or uncaught rejections from killing the process
  process.on('uncaughtException', (err) => {
    console.error('[crash] uncaughtException:', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[crash] unhandledRejection:', reason)
  })

  void getAuth()
  void startMailboxSync()
}

const SETUP_PATHS = ['/setup']
const AUTH_PATHS = ['/login', '/api/auth']

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname

  // Before anything else: if OIDC isn't configured, funnel to setup
  if (!building) {
    const configured = await isOidcConfigured()
    if (!configured) {
      const isSetup = SETUP_PATHS.some((p) => path.startsWith(p))
      if (!isSetup) redirect(302, '/setup')
      return resolve(event)
    }
  }

  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: event.request.headers })

  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }

  const isPublic = [...AUTH_PATHS, ...SETUP_PATHS].some((p) => path.startsWith(p))

  if (!session && !isPublic) {
    redirect(302, '/login')
  }

  return svelteKitHandler({ event, resolve, auth, building })
}

const handleTraffic: Handle = async ({ event, resolve }) => {
  const start = Date.now()
  const { method } = event.request
  const path = event.url.pathname + (event.url.search || '')

  const response = await resolve(event)

  const ms = Date.now() - start
  console.log(`[traffic] ${method} ${path} ${response.status} ${ms}ms`)

  return response
}

export const handle: Handle = sequence(handleTraffic, handleBetterAuth)
