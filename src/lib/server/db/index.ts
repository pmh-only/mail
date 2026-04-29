import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { resolve } from 'path'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '$env/dynamic/private'

// Disable TLS certificate verification globally (self-signed certs on internal mail servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const databaseUrl = env.DATABASE_URL
const demoMode = ['1', 'true', 'yes', 'on'].includes(env.DEMO_MODE?.trim().toLowerCase() ?? '')

function missingDatabaseError() {
  return new Error('DATABASE_URL is not set')
}

const client = demoMode || !databaseUrl
  ? (null as never)
  : postgres(databaseUrl!, {
      max: Number(env.PG_POOL_MAX ?? 10),
      idle_timeout: 20,
      connect_timeout: 10
    })

const db = demoMode
  ? (null as never)
  : databaseUrl
    ? drizzlePg(client, { schema })
    : (new Proxy(
        {},
        {
          get() {
            throw missingDatabaseError()
          }
        }
      ) as never)

export async function runMigrations() {
  if (demoMode || !databaseUrl) return
  await migrate(db, { migrationsFolder: resolve('drizzle') })
}

export { db, client }
