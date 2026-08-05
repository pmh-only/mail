import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { beforeEach, describe, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  env: { DATABASE_URL: 'postgres://mail:test@localhost/mail' } as Record<
    string,
    string | undefined
  >,
  sql: vi.fn().mockResolvedValue(undefined),
  database: {},
  client: vi.fn(() => state.sql),
  drizzle: vi.fn(() => state.database),
  migrate: vi.fn()
}))

vi.mock('$env/dynamic/private', () => ({ env: state.env }))
vi.mock('postgres', () => ({ default: state.client }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: state.drizzle }))
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: state.migrate }))

import * as configuredDatabase from './index'

async function loadDatabase() {
  vi.resetModules()
  return import('./index')
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.client.mockReset()
  state.drizzle.mockReset()
  state.migrate.mockReset()
  state.sql.mockReset().mockResolvedValue(undefined)
})

describe('database client', () => {
  it('runs migrations through the configured static client export', async () => {
    assert.equal(configuredDatabase.client, state.sql)
    assert.equal(configuredDatabase.db, state.database)

    await configuredDatabase.runMigrations()

    assert.equal(state.sql.mock.calls.length, 2)
    assert.equal(state.migrate.mock.calls.length, 1)
  })

  it('exports null clients and skips migrations in demo mode', async () => {
    state.env.DEMO_MODE = ' YES '
    const database = await loadDatabase()

    assert.equal(database.client, null)
    assert.equal(database.db, null)
    await database.runMigrations()
    assert.equal(state.client.mock.calls.length, 0)
    assert.equal(state.migrate.mock.calls.length, 0)
  })

  it('throws a useful error when the database is not configured', async () => {
    const database = await loadDatabase()

    assert.throws(() => database.db.select, /DATABASE_URL is not set/)
    await database.runMigrations()
    assert.equal(state.client.mock.calls.length, 0)
  })

  it('creates a configured client and releases migration locks after success', async () => {
    state.env.DATABASE_URL = 'postgres://mail:test@localhost/mail'
    state.env.PG_POOL_MAX = '4'
    state.env.PG_TLS_REJECT_UNAUTHORIZED = ' false '
    const sql = vi.fn().mockResolvedValue(undefined)
    const databaseHandle = { execute: vi.fn() }
    state.client.mockReturnValue(sql)
    state.drizzle.mockReturnValue(databaseHandle)

    const database = await loadDatabase()

    assert.equal(database.client, sql)
    assert.equal(database.db, databaseHandle)
    assert.deepEqual(state.client.mock.calls[0], [
      state.env.DATABASE_URL,
      {
        max: 4,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: { rejectUnauthorized: false }
      }
    ])
    assert.deepEqual(state.drizzle.mock.calls[0], [sql, { schema: await import('./schema') }])

    await database.runMigrations()

    assert.equal(sql.mock.calls.length, 2)
    assert.match(String(sql.mock.calls[0][0]), /pg_advisory_lock/)
    assert.match(String(sql.mock.calls[1][0]), /pg_advisory_unlock/)
    assert.deepEqual(state.migrate.mock.calls[0], [
      databaseHandle,
      { migrationsFolder: resolve('drizzle') }
    ])
  })

  it('releases the migration lock when migration fails', async () => {
    state.env.DATABASE_URL = 'postgres://mail:test@localhost/mail'
    const sql = vi.fn().mockResolvedValue(undefined)
    const migrationError = new Error('migration failed')
    state.client.mockReturnValue(sql)
    state.drizzle.mockReturnValue({})
    state.migrate.mockRejectedValue(migrationError)
    const database = await loadDatabase()

    await assert.rejects(database.runMigrations(), migrationError)
    assert.equal(sql.mock.calls.length, 2)
    assert.match(String(sql.mock.calls[1][0]), /pg_advisory_unlock/)
  })
})
