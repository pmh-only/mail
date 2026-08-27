import { betterAuth } from 'better-auth/minimal'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { sveltekitCookies } from 'better-auth/svelte-kit'
import { genericOAuth } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { APIError } from 'better-auth/api'
import { env } from '$env/dynamic/private'
import { getRequestEvent } from '$app/server'
import { db } from '$lib/server/db'
import {
  getAuthenticationConfig,
  getOidcConfig,
  isOAuthClientConfigured,
  isOidcConfigComplete
} from '$lib/server/config'
import { isDemoModeEnabled } from '$lib/server/demo'
import { getAuthUserId } from '$lib/server/auth-owner'
import { prepareOidcIssuer } from '$lib/server/oidc-access'

type AuthInstance = Awaited<ReturnType<typeof createAuth>>

let _auth: AuthInstance | null = null
let authCreatedAt = 0
const AUTH_CACHE_TTL_MS = 30_000

function getRpId(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return 'localhost'
  }
}

async function createAuth(allowSignUp = false) {
  if (isDemoModeEnabled()) {
    throw new Error('better-auth is disabled in demo mode')
  }
  const authentication = await getAuthenticationConfig()
  const authUserId = await getAuthUserId()
  const { oidc } = authentication
  const oidcConfigured = isOidcConfigComplete(oidc)
  const oidcIdentity = oidc.issuer || oidc.legacyDiscoveryUrl
  return betterAuth({
    baseURL: env.ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp
    },
    socialProviders: {
      ...(isOAuthClientConfigured(authentication.github)
        ? {
            github: {
              clientId: authentication.github.clientId,
              clientSecret: authentication.github.clientSecret,
              disableSignUp: Boolean(authUserId)
            }
          }
        : {}),
      ...(isOAuthClientConfigured(authentication.discord)
        ? {
            discord: {
              clientId: authentication.discord.clientId,
              clientSecret: authentication.discord.clientSecret,
              disableSignUp: Boolean(authUserId)
            }
          }
        : {})
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: []
      }
    },
    plugins: [
      ...(oidcConfigured
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'oidc',
                  ...(oidc.issuer
                    ? {
                        accountIssuer: oidc.issuer,
                        authorizationUrl: oidc.authorizationUrl,
                        tokenUrl: oidc.tokenUrl,
                        userInfoUrl: oidc.userInfoUrl,
                        pkce: true
                      }
                    : { discoveryUrl: oidc.legacyDiscoveryUrl }),
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  disableSignUp: Boolean(authUserId),
                  scopes: ['openid', 'profile', 'email'],
                  accountSubject: ({ profile }) => {
                    const subject = typeof profile.sub === 'string' ? profile.sub : ''
                    if (!subject) {
                      throw new APIError('BAD_REQUEST', {
                        message: 'The OIDC provider did not return a subject identifier.'
                      })
                    }
                    return subject
                  },
                  mapProfileToUser: async (profile) => {
                    if (
                      typeof profile.email !== 'string' ||
                      !profile.email.trim() ||
                      typeof profile.name !== 'string' ||
                      !profile.name.trim()
                    ) {
                      throw new APIError('BAD_REQUEST', {
                        message: 'The OIDC provider did not return the required profile claims.'
                      })
                    }
                    const currentOidc = await getOidcConfig()
                    const currentIdentity = currentOidc.issuer || currentOidc.legacyDiscoveryUrl
                    if (currentIdentity !== oidcIdentity) {
                      throw new APIError('FORBIDDEN', { message: 'The OIDC provider has changed.' })
                    }
                    if (!(await prepareOidcIssuer(oidcIdentity))) {
                      throw new APIError('FORBIDDEN', {
                        message: 'The OIDC issuer must be changed through authenticated settings.'
                      })
                    }
                    return {
                      emailVerified:
                        profile.email_verified === true || profile.emailVerified === true
                    }
                  }
                }
              ]
            })
          ]
        : []),
      passkey({
        rpID: getRpId(env.ORIGIN || 'http://localhost:3000'),
        rpName: 'Mail',
        origin: env.ORIGIN
      }),
      sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
    ]
  })
}

export async function createSetupAuth(): Promise<AuthInstance> {
  return createAuth(true)
}

export async function getAuth(): Promise<AuthInstance> {
  if (!_auth || Date.now() - authCreatedAt >= AUTH_CACHE_TTL_MS) {
    _auth = await createAuth()
    authCreatedAt = Date.now()
  }
  return _auth
}

export function invalidateAuth() {
  _auth = null
  authCreatedAt = 0
}
