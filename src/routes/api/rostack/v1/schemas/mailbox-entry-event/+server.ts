import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mailboxEntryEventSchema } from '$lib/server/rostack'

export const GET: RequestHandler = () => json(mailboxEntryEventSchema)
