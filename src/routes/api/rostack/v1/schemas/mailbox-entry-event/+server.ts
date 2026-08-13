import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  mailboxEntryEventSchema,
  mailboxEntryEventSchemaUrl,
  schemaWithId
} from '$lib/server/rostack'

export const GET: RequestHandler = ({ url }) =>
  json(schemaWithId(mailboxEntryEventSchema, mailboxEntryEventSchemaUrl(url)))
