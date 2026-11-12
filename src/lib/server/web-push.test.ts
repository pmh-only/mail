import assert from 'node:assert/strict'
import { test } from 'vitest'
import { generateRequestDetails, generateVAPIDKeys, setVapidDetails } from 'web-push'

test('web-push ESM exports generate VAPID keys and authenticated request details', () => {
  const keys = generateVAPIDKeys()
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65)
  assert.equal(Buffer.from(keys.privateKey, 'base64url').length, 32)
  setVapidDetails('mailto:admin@example.com', keys.publicKey, keys.privateKey)

  const details = generateRequestDetails(
    {
      endpoint: 'https://push.example.com/messages/test',
      keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16).toString('base64url') }
    },
    'test notification',
    {
      TTL: 60
    }
  )
  assert.equal(details.endpoint, 'https://push.example.com/messages/test')
  assert.equal(details.method, 'POST')
  assert.equal(details.headers.TTL, 60)
  assert.match(String(details.headers.Authorization), /^vapid /)
})
