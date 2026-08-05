import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  addEmailTrackingPixel,
  emailReadNotification,
  emailReadNotificationRetryDelay,
  emailTrackingPixelResponse,
  emailTrackingPixelUrl,
  isEmailTrackingToken,
  shouldRecordEmailOpen
} from './email-tracking.ts'

test('builds a public tracking URL only from an HTTP origin and opaque token', () => {
  assert.equal(
    emailTrackingPixelUrl('https://mail.example.com', 'opaque-token'),
    'https://mail.example.com/email-open/opaque-token/pixel.gif'
  )
  assert.equal(emailTrackingPixelUrl('javascript:alert(1)', 'opaque-token'), null)
  assert.equal(emailTrackingPixelUrl(undefined, 'opaque-token'), null)
  assert.equal(emailTrackingPixelUrl('https://mail.example.com', null), null)
})

test('accepts only UUID tracking tokens at the public database boundary', () => {
  assert.equal(isEmailTrackingToken('822dcd01-802c-4bbf-a60a-33bf82290ea0'), true)
  assert.equal(isEmailTrackingToken('opaque-token'), false)
  assert.equal(isEmailTrackingToken('822dcd01-802c-4bbf-a60a-33bf82290ea0-extra'), false)
})

test('adds the tracking image before the closing body tag', () => {
  const tracked = addEmailTrackingPixel(
    '<!doctype html><html><body><p>Hello</p></body></html>',
    'https://mail.example.com/email-open/a?x=1&y=2'
  )
  assert.match(tracked, /<p>Hello<\/p><img [^>]+><\/body><\/html>$/)
  assert.match(tracked, /src="https:\/\/mail\.example\.com\/email-open\/a\?x=1&amp;y=2"/)
  assert.match(tracked, /width="1" height="1" alt=""/)
})

test('returns a non-cacheable transparent GIF', async () => {
  const response = emailTrackingPixelResponse()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/gif')
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(
    Number(response.headers.get('content-length')),
    (await response.arrayBuffer()).byteLength
  )
})

test('ignores image loads from the signed-in sender application', () => {
  assert.equal(
    shouldRecordEmailOpen(
      new Request('https://mail.example.com/email-open/token/pixel.gif', {
        headers: { 'sec-fetch-site': 'same-origin' }
      })
    ),
    false
  )
  assert.equal(
    shouldRecordEmailOpen(
      new Request('https://mail.example.com/email-open/token/pixel.gif', {
        headers: { cookie: 'session=sender' }
      })
    ),
    false
  )
  assert.equal(
    shouldRecordEmailOpen(
      new Request('https://mail.example.com/email-open/token/pixel.gif', {
        headers: { 'sec-fetch-site': 'cross-site' }
      })
    ),
    true
  )
})

test('builds a sender notification for a recipient read', () => {
  assert.deepEqual(
    emailReadNotification(JSON.stringify({ subject: 'Quarterly update' }), '/sent/42', 7),
    {
      title: 'Email read',
      body: 'A recipient read "Quarterly update".',
      url: '/sent/42',
      tag: 'email-read-7'
    }
  )
  assert.equal(emailReadNotification('{', '/', 8).body, 'A recipient read "(no subject)".')
})

test('backs off notification retries with a five-minute cap', () => {
  assert.equal(emailReadNotificationRetryDelay(1), 2_000)
  assert.equal(emailReadNotificationRetryDelay(8), 256_000)
  assert.equal(emailReadNotificationRetryDelay(20), 300_000)
})

test('handles malformed origins, body-less HTML, and empty notification subjects', () => {
  assert.equal(emailTrackingPixelUrl('not an origin', 'token'), null)
  assert.equal(emailTrackingPixelUrl('ftp://mail.example.com', 'token'), null)
  assert.match(addEmailTrackingPixel('<p>Hello</p>', 'https://example.com/a"&b'), /&quot;&amp;/)
  assert.equal(
    emailReadNotification(JSON.stringify({ subject: '   ' }), '/', 1).body,
    'A recipient read "(no subject)".'
  )
  assert.equal(emailReadNotificationRetryDelay(0), 1_000)
  assert.equal(
    shouldRecordEmailOpen(new Request('https://mail.example.com/email-open/token/pixel.gif')),
    true
  )
})
