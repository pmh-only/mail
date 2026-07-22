import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { previewCleanupRule } from '$lib/server/cleanup-rules'
import { isDemoModeEnabled } from '$lib/server/demo'

export const POST: RequestHandler = async ({ request }) => {
  try {
    if (isDemoModeEnabled()) return json({ matches: [], warning: null })

    const result = await previewCleanupRule(await request.json())
    return json(result)
  } catch (err) {
    return error(400, err instanceof Error ? err.message : 'Invalid cleanup rule')
  }
}
