import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { discoveryDocument } from '$lib/server/rostack'
import { rostackProblem } from '$lib/server/rostack-http'

export const GET: RequestHandler = ({ url, request }) => {
  const etag = '"mail-rostack-2026-08-13-1"'
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers: { etag } })
  try {
    return json(discoveryDocument(url), {
      headers: { 'cache-control': 'public, max-age=300', etag }
    })
  } catch {
    return rostackProblem('internal-error')
  }
}
