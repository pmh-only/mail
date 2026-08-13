import type { RequestHandler } from './$types'
import { RostackError } from '$lib/server/rostack'
import { isRostackConcreteResource, listRostackResource } from '$lib/server/rostack-resources'
import {
  acceptsJson,
  isRostackHttpProblemCode,
  rostackJson,
  rostackProblem
} from '$lib/server/rostack-http'

export const GET: RequestHandler = async ({ params, url, locals, request }) => {
  if (!acceptsJson(request.headers.get('accept')))
    return rostackProblem('representation-not-acceptable')
  if (!isRostackConcreteResource(params.resource)) return rostackProblem('resource-not-found')
  try {
    return rostackJson(await listRostackResource(params.resource, url, locals.rostackPrincipalId!))
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
