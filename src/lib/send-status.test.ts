import assert from 'node:assert/strict'
import { test } from 'vitest'
import { sendStatusFromJobStatus, sendStatusLabel } from './send-status.ts'

test('maps delivery and job states to the composer send status', () => {
  assert.equal(sendStatusFromJobStatus('pending'), 'sending')
  assert.equal(sendStatusFromJobStatus('running'), 'sending')
  assert.equal(sendStatusFromJobStatus('failed'), 'failed')
  assert.equal(sendStatusFromJobStatus('done'), 'sent')
  assert.equal(sendStatusFromJobStatus('pending', new Date()), 'sent')
  assert.equal(sendStatusFromJobStatus('unknown'), null)
})

test('shows read only after a sent message has an open timestamp', () => {
  assert.equal(sendStatusLabel('sending', null), 'Sending')
  assert.equal(sendStatusLabel('failed', '2026-07-23T12:00:00.000Z'), 'Failed')
  assert.equal(sendStatusLabel('sent', null), 'Sent')
  assert.equal(sendStatusLabel('sent', '2026-07-23T12:00:00.000Z'), 'Read')
})
