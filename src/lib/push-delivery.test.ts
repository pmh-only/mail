import assert from 'node:assert/strict'
import { test } from 'vitest'
import { pushDeliveryComplete } from './push-delivery.ts'

test('completes after any delivery without retrying healthy devices', () => {
  assert.equal(pushDeliveryComplete(['delivered', 'retryable']), true)
  assert.equal(pushDeliveryComplete(['delivered', 'terminal']), true)
})

test('retries only when no endpoint received the push and a failure is retryable', () => {
  assert.equal(pushDeliveryComplete([]), false)
  assert.equal(pushDeliveryComplete(['retryable', 'terminal']), false)
  assert.equal(pushDeliveryComplete(['terminal']), true)
})
