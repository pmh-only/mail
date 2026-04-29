import type { Handle, HandleServerError } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { building } from '$app/environment'
import { getAuth } from '$lib/server/auth'
import { isOidcConfigured } from '$lib/server/config'
import { startImapJobWorker } from '$lib/server/imap-queue'
import { repairThreadKeys, startMailboxSync } from '$lib/server/mail'
import { logServerError } from '$lib/server/perf'
import { runMigrations } from '$lib/server/db'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { getDemoAuthSession, isDemoModeEnabled } from '$lib/server/demo'

// Warm up eagerly so the first request doesn't pay initialization costs
if (!building) {
  // Prevent connection errors or uncaught rejections from killing the process
  process.on('uncaughtException', (err) => {
    console.error('[crash] uncaughtException:', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[crash] unhandledRejection:', reason)
  })

  if (!isDemoModeEnabled()) {
    void runMigrations()
      .then(async () => {
        await repairThreadKeys()
        void getAuth()
        startImapJobWorker()
        void startMailboxSync()
      })
      .catch((err) => {
        console.error('[startup] migration failed, aborting startup:', err)
        process.exit(1)
      })
  }
}

const SETUP_PATHS = ['/setup']
const AUTH_PATHS = ['/login', '/api/auth', '/share']

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname

  if (isDemoModeEnabled()) {
    const demo = getDemoAuthSession()
    event.locals.session = demo.session
    event.locals.user = demo.user
    return resolve(event)
  }

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
  const start = performance.now()
  const { method } = event.request
  const path = event.url.pathname + (event.url.search || '')

  const response = await resolve(event)

  const ms = Number((performance.now() - start).toFixed(1))
  const contentLength = response.headers.get('content-length')
  console.log(
    `[traffic] ${method} ${path} ${response.status} ${ms}ms${contentLength ? ` size=${contentLength}` : ''}`
  )

  return response
}

export const handle: Handle = sequence(handleTraffic, handleBetterAuth)

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  logServerError('request', error, {
    method: event.request.method,
    path: event.url.pathname + event.url.search,
    routeId: event.route.id ?? null,
    status,
    message
  })

  return { message }
}
