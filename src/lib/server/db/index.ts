import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import path from 'node:path';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

// Disable TLS certificate verification globally (self-signed certs on internal mail servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);
client.pragma('journal_mode = WAL');
const db = drizzle(client, { schema });

const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

migrate(db, { migrationsFolder });

export { db };
