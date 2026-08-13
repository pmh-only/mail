import type { RequestHandler } from './$types'
import { listRostackEntries, RostackError } from '$lib/server/rostack'
import {
  acceptsJson,
  isRostackHttpProblemCode,
  rostackJson,
  rostackProblem
} from '$lib/server/rostack-http'

export const GET: RequestHandler = async ({ url, locals, request }) => {
  if (!acceptsJson(request.headers.get('accept')))
    return rostackProblem('representation-not-acceptable')
  try {
    return rostackJson(await listRostackEntries(url, locals.rostackPrincipalId!))
  } catch (error) {
    if (error instanceof RostackError && isRostackHttpProblemCode(error.code))
      return rostackProblem(error.code, { detail: error.message })
    return rostackProblem('internal-error')
  }
}

export const POST: RequestHandler = () =>
  rostackProblem('method-not-allowed', { headers: { allow: 'GET, HEAD, OPTIONS' } })
export const PUT = POST
export const PATCH = POST
export const DELETE = POST
