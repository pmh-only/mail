import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  normalizeReadControlVersion,
  readControlSubscriptions,
  readNotificationBatches,
  supportsReadControl
} from './push-control.ts'

test('only enables read controls for subscriptions that explicitly support them', () => {
  assert.equal(normalizeReadControlVersion(undefined), 0)
  assert.equal(normalizeReadControlVersion(0), 0)
  assert.equal(normalizeReadControlVersion(1), 1)
  assert.equal(normalizeReadControlVersion(2), 0)
  assert.equal(supportsReadControl(0), false)
  assert.equal(supportsReadControl(1), true)
  assert.deepEqual(
    readControlSubscriptions([
      { endpoint: 'legacy', readControlVersion: 0 },
      { endpoint: 'capable', readControlVersion: 1 }
    ]).map((subscription) => subscription.endpoint),
    ['capable']
  )
})

test('deduplicates and bounds read-notification control payloads', () => {
  const ids = [0, -1, 1, 1, ...Array.from({ length: 250 }, (_, index) => index + 2)]
  const batches = readNotificationBatches(ids)

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [200, 51]
  )
  assert.deepEqual(
    batches.flat(),
    Array.from({ length: 251 }, (_, index) => index + 1)
  )
})
