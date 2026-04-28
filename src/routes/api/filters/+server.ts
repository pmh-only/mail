import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db'
import { mailFilter } from '$lib/server/db/schema'
import { logServerEvent } from '$lib/server/perf'
import { asc } from 'drizzle-orm'

export const GET: RequestHandler = async () => {
  const filters = await db.select().from(mailFilter).orderBy(asc(mailFilter.sortOrder))
  return json({ filters })
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()

  if (!body.field || !body.operator || !body.value || !body.action) {
    return error(400, 'Missing required fields: field, operator, value, action')
  }

  const [inserted] = await db
    .insert(mailFilter)
    .values({
      field: body.field,
      operator: body.operator,
      value: body.value,
      action: body.action,
      target: body.target ?? null,
      enabled: body.enabled !== false,
      sortOrder: body.sort_order ?? 0
    })
    .returning({ id: mailFilter.id })

  if (!inserted) {
    logServerEvent('api.filters.POST.insertReturnedEmpty', {
      field: body.field,
      action: body.action
    })
    return error(500, 'Failed to create filter')
  }

  return json({ id: inserted.id })
}
