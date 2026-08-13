import { createHash } from 'node:crypto'
import type { RequestHandler } from './$types'
import { RostackError } from '$lib/server/rostack'
import { getRostackResource, isRostackConcreteResource } from '$lib/server/rostack-resources'
import {
  acceptsJson,
  isRostackHttpProblemCode,
  rostackJson,
  rostackProblem
} from '$lib/server/rostack-http'

export const GET: RequestHandler = async ({ params, url, request }) => {
  if (!acceptsJson(request.headers.get('accept')))
    return rostackProblem('representation-not-acceptable')
  if (!isRostackConcreteResource(params.resource)) return rostackProblem('resource-not-found')
  try {
    const item = await getRostackResource(
      params.resource,
      params.id,
      url.searchParams.get('fields')
    )
    const etag = `"${createHash('sha256').update(JSON.stringify(item)).digest('base64url')}"`
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { etag } })
    return rostackJson(item, { etag })
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
