import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mailboxEntrySchema } from '$lib/server/rostack'

export const GET: RequestHandler = () => json(mailboxEntrySchema)
