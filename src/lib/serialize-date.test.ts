import assert from 'node:assert/strict'
import { test } from 'vitest'
import { serializeDate } from './serialize-date.ts'

test('serializes database date values without assuming their runtime type', () => {
  const timestamp = '2026-07-23 12:00:00+00'

  assert.equal(serializeDate(new Date('2026-07-23T12:00:00.000Z')), '2026-07-23T12:00:00.000Z')
  assert.equal(serializeDate(timestamp), timestamp)
  assert.equal(serializeDate(null), null)
  assert.equal(serializeDate(undefined), null)
})
