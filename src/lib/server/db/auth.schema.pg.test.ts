import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createTableRelationsHelpers } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from './auth.schema.pg'

const tableName = Symbol.for('drizzle:Name')
const columns = Symbol.for('drizzle:Columns')
describe('authentication PostgreSQL schema', () => {
  it('exports all authentication tables, columns, and relation definitions', () => {
    assert.deepEqual(Object.keys(schema).sort(), [
      'account',
      'accountRelations',
      'mailApiKey',
      'passkey',
      'passkeyRelations',
      'session',
      'sessionRelations',
      'user',
      'userRelations',
      'verification'
    ])

    for (const [table, name, expectedColumns] of [
      [schema.user, 'user', ['id', 'name', 'email', 'emailVerified']],
      [schema.session, 'session', ['id', 'expiresAt', 'token', 'userId']],
      [schema.account, 'account', ['id', 'accountId', 'providerId', 'userId']],
      [schema.verification, 'verification', ['id', 'identifier', 'value', 'expiresAt']],
      [schema.passkey, 'passkey', ['id', 'publicKey', 'userId', 'credentialID']],
      [schema.mailApiKey, 'mail_api_key', ['id', 'userId', 'prefix', 'keyHash']]
    ] as const) {
      const inspectedTable = table as unknown as Record<
        PropertyKey,
        Record<string, unknown> | string
      >
      assert.equal(inspectedTable[tableName], name)
      const tableColumns = inspectedTable[columns] as Record<string, unknown>
      for (const column of expectedColumns) assert.ok(tableColumns[column], `${name}.${column}`)
    }
  })

  it('retains cascade relationships, indexes, defaults, and timestamp update hooks', () => {
    assert.equal(schema.user.emailVerified.default, false)
    assert.equal(getTableConfig(schema.session).foreignKeys[0].onDelete, 'cascade')
    assert.equal(getTableConfig(schema.account).foreignKeys[0].onDelete, 'cascade')
    assert.equal(getTableConfig(schema.passkey).foreignKeys[0].onDelete, 'cascade')
    assert.equal(schema.session.updatedAt.onUpdateFn?.() instanceof Date, true)
    assert.equal(schema.user.updatedAt.onUpdateFn?.() instanceof Date, true)

    assert.equal(getTableConfig(schema.session).indexes.length, 1)
    assert.equal(getTableConfig(schema.mailApiKey).indexes.length, 2)
    assert.deepEqual(
      Object.keys(schema.userRelations.config(createTableRelationsHelpers(schema.user))).sort(),
      ['accounts', 'apiKeys', 'passkeys', 'sessions']
    )
    assert.deepEqual(
      Object.keys(schema.sessionRelations.config(createTableRelationsHelpers(schema.session))),
      ['user']
    )
    assert.deepEqual(
      Object.keys(schema.accountRelations.config(createTableRelationsHelpers(schema.account))),
      ['user']
    )
    assert.deepEqual(
      Object.keys(schema.passkeyRelations.config(createTableRelationsHelpers(schema.passkey))),
      ['user']
    )

    for (const table of [
      schema.user,
      schema.session,
      schema.account,
      schema.verification,
      schema.passkey,
      schema.mailApiKey
    ]) {
      const config = getTableConfig(table)
      for (const foreignKey of config.foreignKeys) foreignKey.reference()
      for (const column of config.columns) column.onUpdateFn?.()
    }
  })
})
