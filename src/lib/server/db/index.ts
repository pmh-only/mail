import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '$env/dynamic/private'

// Disable TLS certificate verification globally (self-signed certs on internal mail servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const databaseUrl = env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const client = postgres(databaseUrl, {
  max: Number(env.PG_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10
})

const db = drizzlePg(client, { schema })

export { db, client }
