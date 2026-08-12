import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { ROSTACK_API_VERSION } from '$lib/server/rostack'

export const GET: RequestHandler = ({ locals }) =>
  json({ principal_id: locals.rostackPrincipalId, api_version: ROSTACK_API_VERSION })
