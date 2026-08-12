import type { RequestHandler } from './$types'
import { listRostackEntries, RostackError, ROSTACK_API_VERSION } from '$lib/server/rostack'

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

export const GET: RequestHandler = async ({ url, locals, request }) => {
  if (
    !(request.headers.get('accept') ?? '*/*')
      .split(',')
      .some((value) => value.includes('*/*') || value.includes('application/json'))
  )
    return response(
      {
        type: 'https://spec.pmh.codes/problems/not-acceptable',
        title: 'No acceptable representation',
        status: 406
      },
      406
    )
  try {
    return response(await listRostackEntries(url, locals.rostackPrincipalId!))
  } catch (error) {
    if (error instanceof RostackError)
      return response(
        {
          type: `https://spec.pmh.codes/problems/${error.code}`,
          title: error.message,
          status: error.status
        },
        error.status
      )
    throw error
  }
}
