import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDirtyMailbox,
  MAX_CONNECTIONS_PER_ACCOUNT,
  reconnectDelayMs
} from './imap-connections.ts'

test('backs off reconnects and caps the delay', () => {
  assert.equal(reconnectDelayMs(0), 1_000)
  assert.equal(reconnectDelayMs(3), 8_000)
  assert.equal(reconnectDelayMs(20), 256_000)
})

test('coalesces repeated mailbox events and caps account connection roles', () => {
  const dirty = new Map<string, Set<string>>()
  for (let index = 0; index < 100; index += 1) addDirtyMailbox(dirty, 'primary', 'INBOX')
  assert.deepEqual([...dirty.get('primary')!], ['INBOX'])
  assert.equal(MAX_CONNECTIONS_PER_ACCOUNT, 2)
})
