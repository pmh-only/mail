import type { PageServerLoad } from './$types'
import { getDisplayConfig } from '$lib/server/config'
import { getSimplifiedViewEnabled } from '$lib/server/preferences'
import { env } from '$env/dynamic/private'

export const load: PageServerLoad = async ({ cookies }) => {
  const config = await getDisplayConfig()
  return {
    config,
    origin: env.ORIGIN ?? '',
    simplifiedView: getSimplifiedViewEnabled(cookies)
  }
}
