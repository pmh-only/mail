import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { resolve } from 'path'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '$env/dynamic/private'
import { isDemoModeEnabled } from '$lib/server/demo'

// Disable TLS certificate verification globally (self-signed certs on internal mail servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const databaseUrl = env.DATABASE_URL
const demoMode = isDemoModeEnabled()
if (!demoMode && !databaseUrl) throw new Error('DATABASE_URL is not set')

const client = demoMode
  ? (null as never)
  : postgres(databaseUrl!, {
      max: Number(env.PG_POOL_MAX ?? 10),
      idle_timeout: 20,
      connect_timeout: 10
    })

const db = demoMode ? (null as never) : drizzlePg(client, { schema })

export async function runMigrations() {
  if (demoMode) return
  await migrate(db, { migrationsFolder: resolve('drizzle') })
}

export { db, client }
