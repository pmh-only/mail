import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getAuth } from '$lib/server/auth';
import { isOidcConfigured } from '$lib/server/config';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const SETUP_PATHS = ['/setup'];
const AUTH_PATHS = ['/login', '/api/auth'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Before anything else: if OIDC isn't configured, funnel to setup
	if (!building) {
		const configured = await isOidcConfigured();
		if (!configured) {
			const isSetup = SETUP_PATHS.some((p) => path.startsWith(p));
			if (!isSetup) redirect(302, '/setup');
			return resolve(event);
		}
	}

	const auth = await getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	const isPublic = [...AUTH_PATHS, ...SETUP_PATHS].some((p) => path.startsWith(p));

	if (!session && !isPublic) {
		redirect(302, '/login');
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
