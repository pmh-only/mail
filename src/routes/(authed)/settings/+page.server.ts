import type { PageServerLoad } from './$types';
import { getDisplayConfig } from '$lib/server/config';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async () => {
	const config = await getDisplayConfig();
	return { config, origin: env.ORIGIN ?? '' };
};
