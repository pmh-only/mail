import type { LayoutServerLoad } from './$types'
import { isDemoModeEnabled } from '$lib/server/demo'

export const load: LayoutServerLoad = async () => {
  return {
    demoMode: isDemoModeEnabled()
  }
}
