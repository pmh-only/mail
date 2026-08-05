import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  hasExplicitSearchFilter,
  parseNaturalSearchSelection,
  validateMailSearchRegex
} from './mail-search.ts'

test('detects explicit mail search filters', () => {
  assert.equal(hasExplicitSearchFilter('billing notices from last month'), false)
  assert.equal(hasExplicitSearchFilter('from:billing@example.com'), true)
  assert.equal(hasExplicitSearchFilter('urgent has:attachment'), true)
  assert.equal(hasExplicitSearchFilter('discuss from someone'), false)
  assert.equal(hasExplicitSearchFilter('subject:"two words"'), true)
  assert.equal(hasExplicitSearchFilter('"from:billing@example.com"'), true)
})

test('rejects unsafe or oversized regular expressions', () => {
  assert.equal(validateMailSearchRegex('invoice|billing|payment'), 'invoice|billing|payment')
  assert.throws(() => validateMailSearchRegex('(?=invoice)'), /unsupported/)
  assert.throws(() => validateMailSearchRegex('(invoice)\\1'), /unsupported/)
  assert.throws(() => validateMailSearchRegex('\\binvoice\\b'), /unsupported/)
  assert.throws(() => validateMailSearchRegex('x'.repeat(161)), /between 1 and 160/)
})

test('accepts only message IDs returned by search tools', () => {
  assert.deepEqual(parseNaturalSearchSelection('{"message_ids":[3,1,3]}', new Set([1, 3])), [3, 1])
  assert.throws(
    () => parseNaturalSearchSelection('{"message_ids":[9]}', new Set([1, 3])),
    /unknown message ID/
  )
})
