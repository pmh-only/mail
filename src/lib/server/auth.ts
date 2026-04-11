import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { genericOAuth } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { getOidcConfig } from '$lib/server/config';

type AuthInstance = ReturnType<typeof betterAuth>;

let _auth: AuthInstance | null = null;

async function createAuth(): Promise<AuthInstance> {
	const oidc = await getOidcConfig();
	return betterAuth({
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'sqlite' }),
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: 'oidc',
						discoveryUrl: oidc.discoveryUrl,
						clientId: oidc.clientId,
						clientSecret: oidc.clientSecret,
						scopes: ['openid', 'profile', 'email']
					}
				]
			}),
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

export async function getAuth(): Promise<AuthInstance> {
	if (!_auth) {
		_auth = await createAuth();
	}
	return _auth;
}

export function invalidateAuth() {
	_auth = null;
}
