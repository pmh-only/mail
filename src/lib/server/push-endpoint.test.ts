import assert from 'node:assert/strict'
import test from 'node:test'
import { isPublicIpAddress, validatePushSubscription } from './push-endpoint.ts'

const valid = {
  endpoint: 'https://push.example.test/subscription',
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'),
    auth: Buffer.alloc(16).toString('base64url')
  }
}

test('validates and canonicalizes push subscriptions', () => {
  assert.equal(validatePushSubscription(valid).endpoint, valid.endpoint)
  for (const endpoint of [
    'http://example.test',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://[::1]/x'
  ]) {
    assert.throws(() => validatePushSubscription({ ...valid, endpoint }))
  }
})

test('rejects private and reserved IP addresses', () => {
  for (const address of [
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '127.0.0.1',
    '::1',
    'fd00::1'
  ]) {
    assert.equal(isPublicIpAddress(address), false)
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true)
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true)
})
