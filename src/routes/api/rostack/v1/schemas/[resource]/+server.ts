import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { schemaWithId } from '$lib/server/rostack'
import {
  isRostackConcreteResource,
  rostackResourceSchema,
  rostackResourceSchemaUrl
} from '$lib/server/rostack-resources'
import { rostackJson, rostackProblem } from '$lib/server/rostack-http'

export const GET: RequestHandler = ({ params }) => {
  if (!isRostackConcreteResource(params.resource)) return rostackProblem('resource-not-found')
  const base = String(env.ORIGIN).replace(/\/$/, '')
  return rostackJson(
    schemaWithId(
      rostackResourceSchema(params.resource),
      rostackResourceSchemaUrl(base, params.resource)
    )
  )
}
