import type { Handle, HandleServerError } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { building } from '$app/environment'
import { getAuth, invalidateAuth } from '$lib/server/auth'
import { isAuthenticationConfigured } from '$lib/server/config'
import { repairThreadKeys } from '$lib/server/mail'
import { logServerError } from '$lib/server/perf'
import { runMigrations } from '$lib/server/db'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { getDemoAuthSession, isDemoModeEnabled } from '$lib/server/demo'
import { claimAuthUser, getAuthUserId } from '$lib/server/auth-owner'
import { bearerApiKey, verifyApiKey } from '$lib/server/api-keys'
import { checkApiRateLimit, checkApiSendRateLimit } from '$lib/server/api-rate-limit'

let startupPromise = Promise.resolve()

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
    startupPromise = runMigrations()
      .then(async () => {
        await repairThreadKeys()
        void getAuth()
      })
      .catch((err) => {
        console.error('[startup] migration failed, aborting startup:', err)
        process.exit(1)
      })
  }
}

const handleStartup: Handle = async ({ event, resolve }) => {
  await startupPromise
  return resolve(event)
}

const SETUP_PATHS = ['/setup']
const EXACT_PUBLIC_PATHS = new Set(['/login', '/setup', '/api-docs'])
const PUBLIC_PATH_PREFIXES = ['/api/auth', '/share', '/attachments']
const EXTERNAL_API_PREFIX = '/api/external/v1'
const EMAIL_TRACKING_PREFIX = '/email-open/'

function isExternalApiPath(path: string) {
  return path === EXTERNAL_API_PREFIX || path.startsWith(`${EXTERNAL_API_PREFIX}/`)
}

function isPublicPath(path: string) {
  return (
    EXACT_PUBLIC_PATHS.has(path) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
}

function redactCapabilityPath(path: string) {
  if (path.startsWith(EMAIL_TRACKING_PREFIX)) return `${EMAIL_TRACKING_PREFIX}[redacted]/pixel.gif`
  if (/^\/share\/[^/]+/.test(path)) return path.replace(/^\/share\/[^/]+/, '/share/[redacted]')
  if (/^\/attachments\/[^/]+/.test(path)) {
    return path.replace(/^\/attachments\/[^/]+/, '/attachments/[redacted]')
  }
  return path
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname

  if (isDemoModeEnabled()) {
    if (isExternalApiPath(path)) {
      return new Response(JSON.stringify({ error: 'External API is disabled in demo mode' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      })
    }
    const demo = getDemoAuthSession()
    event.locals.session = demo.session
    event.locals.user = demo.user
    return resolve(event)
  }

  if (path.startsWith(EMAIL_TRACKING_PREFIX)) return resolve(event)

  // Before anything else: if no owner or external provider exists, funnel to setup.
  if (!building) {
    const configured = await isAuthenticationConfigured()
    if (!configured) {
      const isSetup = SETUP_PATHS.includes(path)
      if (!isSetup) redirect(302, '/setup')
      return resolve(event)
    }
  }

  const auth = await getAuth()

  if (isExternalApiPath(path)) {
    const rawKey = bearerApiKey(event.request.headers)
    const principal = rawKey ? await verifyApiKey(rawKey) : null
    const ownerId = principal ? await getAuthUserId() : null
    if (!principal || !ownerId || principal.userId !== ownerId) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer realm="mail-api"'
        }
      })
    }

    event.locals.user = principal.user
    event.locals.apiKey = { id: principal.id, userId: principal.userId }
    const directSend = event.request.method === 'POST' && path === `${EXTERNAL_API_PREFIX}/messages`
    if (!checkApiRateLimit(principal.id) || (directSend && !checkApiSendRateLimit(principal.id))) {
      return new Response(JSON.stringify({ error: 'API rate limit exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60' }
      })
    }
    return resolve(event)
  }

  const authSession = await auth.api.getSession({ headers: event.request.headers })
  const ownerId = authSession ? await getAuthUserId() : null
  const authorized = authSession
    ? ownerId
      ? ownerId === authSession.user.id
      : await claimAuthUser(authSession.user.id)
    : false
  if (authSession && !ownerId && authorized) invalidateAuth()
  const session = authSession && authorized ? authSession : null

  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }

  const isPublic = isPublicPath(path)

  if (!session && !isPublic) {
    redirect(302, '/login')
  }

  if (path === '/api/auth/sign-up/email') {
    return new Response('Public sign-up is disabled.', { status: 403 })
  }

  if (path === '/api/auth/passkey/delete-passkey') {
    return new Response('Use the protected passkey settings endpoint.', { status: 403 })
  }

  return svelteKitHandler({ event, resolve, auth, building })
}

const handleTraffic: Handle = async ({ event, resolve }) => {
  const start = performance.now()
  const { method } = event.request
  const path = event.url.pathname
  const loggedPath = redactCapabilityPath(path)

  const response = await resolve(event)

  const ms = Number((performance.now() - start).toFixed(1))
  const contentLength = response.headers.get('content-length')
  console.log(
    `[traffic] ${method} ${loggedPath} ${response.status} ${ms}ms${contentLength ? ` size=${contentLength}` : ''}`
  )

  return response
}

export const handle: Handle = sequence(handleStartup, handleTraffic, handleBetterAuth)

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  logServerError('request', error, {
    method: event.request.method,
    path: redactCapabilityPath(event.url.pathname),
    routeId: event.route.id ?? null,
    status,
    message
  })

  return { message }
}
