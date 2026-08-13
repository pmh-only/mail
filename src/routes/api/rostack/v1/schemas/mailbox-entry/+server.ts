import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mailboxEntrySchema, mailboxEntrySchemaUrl, schemaWithId } from '$lib/server/rostack'

export const GET: RequestHandler = ({ url }) =>
  json(schemaWithId(mailboxEntrySchema, mailboxEntrySchemaUrl(url)))
