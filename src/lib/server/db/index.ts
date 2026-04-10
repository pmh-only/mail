import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);
const db = drizzle(client, { schema });

const migrationsFolder = path.resolve(
	fileURLToPath(new URL('../../../../drizzle', import.meta.url))
);

migrate(db, { migrationsFolder });

export { db };
