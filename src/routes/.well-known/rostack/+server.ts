import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { discoveryDocument } from '$lib/server/rostack'

export const GET: RequestHandler = ({ url }) =>
  json(discoveryDocument(url), {
    headers: { 'cache-control': 'public, max-age=300', etag: '"mail-rostack-2026-08-13"' }
  })
