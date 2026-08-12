import type { RequestHandler } from './$types'
import { ExternalApiError } from '$lib/server/external-mail'
import { getRostackEntry, RostackError, ROSTACK_API_VERSION } from '$lib/server/rostack'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status === 200 ? 'application/json' : 'application/problem+json',
      'x-rostack-protocol-version': 'rostack_v1',
      'x-rostack-api-version': ROSTACK_API_VERSION
    }
  })
}

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const item = await getRostackEntry(params.id, url.searchParams.get('fields'))
    return response(item)
  } catch (error) {
    if (error instanceof RostackError || error instanceof ExternalApiError) {
      const code = error instanceof RostackError ? error.code : 'not-found'
      return response(
        {
          type: `https://spec.pmh.codes/problems/${code}`,
          title: error.message,
          status: error.status
        },
        error.status
      )
    }
    throw error
  }
}
