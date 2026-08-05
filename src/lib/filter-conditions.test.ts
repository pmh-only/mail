import assert from 'node:assert/strict'
import { test } from 'vitest'
import { normalizeFilterConditions } from './filter-conditions.ts'

test('normalizes valid filter condition sets', () => {
  assert.deepEqual(
    normalizeFilterConditions({
      match: 'any',
      conditions: [
        { field: 'from', operator: 'contains', value: ' sender@example.com ' },
        { field: 'subject', operator: 'starts_with', value: 'Invoice' }
      ]
    }),
    {
      version: 1,
      match: 'any',
      conditions: [
        { field: 'from', operator: 'contains', value: 'sender@example.com' },
        { field: 'subject', operator: 'starts_with', value: 'Invoice' }
      ]
    }
  )
})

test('defaults missing condition field and operator values and rejects invalid conditions', () => {
  assert.deepEqual(
    normalizeFilterConditions({
      match: 'unexpected',
      conditions: [
        { value: ' value ' },
        { field: 'bcc', operator: 'contains', value: 'person@example.com' },
        { field: 'to', operator: 'matches', value: 'person@example.com' },
        { field: 'cc', operator: 'equals', value: '   ' },
        { field: 'to', operator: 'contains', value: 42 },
        null,
        []
      ]
    }),
    {
      version: 1,
      match: 'all',
      conditions: [{ field: 'from', operator: 'contains', value: 'value' }]
    }
  )
})

test('uses only a valid fallback for missing or unusable condition sets', () => {
  const fallback = { field: 'to', operator: 'ends_with', value: ' @example.com ' }

  assert.deepEqual(normalizeFilterConditions(null, fallback), {
    version: 1,
    match: 'all',
    conditions: [{ field: 'to', operator: 'ends_with', value: '@example.com' }]
  })
  assert.deepEqual(normalizeFilterConditions({ conditions: 'not an array' }, fallback), {
    version: 1,
    match: 'all',
    conditions: [{ field: 'to', operator: 'ends_with', value: '@example.com' }]
  })
  assert.deepEqual(
    normalizeFilterConditions(undefined, { field: 'bcc', operator: 'contains', value: 'x' }),
    {
      version: 1,
      match: 'all',
      conditions: []
    }
  )
  assert.deepEqual(normalizeFilterConditions({ conditions: [] }), {
    version: 1,
    match: 'all',
    conditions: []
  })
})
