import assert from 'node:assert/strict'
import { test } from 'vitest'
import nodemailer from 'nodemailer'
import { simpleParser } from 'mailparser'
import { addEmailTrackingPixel } from './email-tracking.ts'
import {
  outgoingListHeaders,
  outgoingMessageBody,
  outgoingSenderAddress
} from './outgoing-message.ts'

test('creates a mailto List-Unsubscribe header for the sender address', async () => {
  assert.equal(outgoingSenderAddress('Mail Team <sender@example.com>'), 'sender@example.com')
  assert.equal(outgoingSenderAddress('sender@example.com (Mail Team)'), 'sender@example.com')
  assert.equal(outgoingSenderAddress('"Team <Ops>" <sender@example.com>'), 'sender@example.com')
  assert.equal(
    outgoingSenderAddress('sender@example.com (support@example.net)'),
    'sender@example.com'
  )
  assert.equal(outgoingSenderAddress('Mail Team <"foo bar"@example.com>'), '"foo bar"@example.com')
  assert.deepEqual(outgoingListHeaders('Mail Team <"foo bar"@example.com>'), {
    'List-Unsubscribe': '<mailto:%22foo%20bar%22@example.com>'
  })
  assert.deepEqual(outgoingListHeaders('user?tag@example.com'), {
    'List-Unsubscribe': '<mailto:user%3Ftag@example.com>'
  })
  assert.deepEqual(outgoingListHeaders('sender@[127.0.0.1]'), {
    'List-Unsubscribe': '<mailto:sender@%5B127.0.0.1%5D>'
  })
  for (const invalid of ['invalid-sender', 'a@@example.com', 'a@example..com', 'a@-example.com']) {
    assert.throws(() => outgoingListHeaders(invalid), /invalid sender address/)
  }
  assert.deepEqual(outgoingListHeaders('Mail Team <sender@example.com>'), {
    'List-Unsubscribe': '<mailto:sender@example.com>'
  })

  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true })
  const sent = await transport.sendMail({
    from: 'Mail Team <sender@example.com>',
    to: 'recipient@example.com',
    subject: 'Header test',
    text: 'Hello',
    headers: outgoingListHeaders('Mail Team <sender@example.com>')
  })
  assert.match(sent.message.toString(), /^List-Unsubscribe: <mailto:sender@example\.com>\r?$/m)
})

test('wraps HTML fragments and creates a plain-text alternative', () => {
  const body = outgoingMessageBody('<p>Hello <strong>mail</strong>.</p><p>Second line.</p>')

  assert.match(body.html ?? '', /^<!doctype html><html>/i)
  assert.match(body.html ?? '', /<body><p>Hello/)
  assert.equal(body.text, 'Hello mail.\n\nSecond line.')
})

test('preserves complete HTML documents', () => {
  const html = '<html><body><p>Complete</p></body></html>'
  assert.deepEqual(outgoingMessageBody(html), { html, text: 'Complete' })
})

test('does not mistake comments or script content for an HTML document element', () => {
  for (const fragment of [
    '<!-- <html> --><p>Comment case</p>',
    '<script>const tag = "<html>"</script><p>Script case</p>'
  ]) {
    assert.match(outgoingMessageBody(fragment).html ?? '', /^<!doctype html><html>/i)
  }
})

test('keeps a plain-text MIME alternative for HTML without visible text', () => {
  assert.equal(outgoingMessageBody('<div></div>').text, ' ')
  assert.deepEqual(outgoingMessageBody(undefined), {})
})

test('includes a tracking image in the delivered HTML MIME content', async () => {
  const body = outgoingMessageBody('<p>Tracked message</p>')
  body.html = addEmailTrackingPixel(
    body.html ?? '',
    'https://mail.example.com/email-open/822dcd01-802c-4bbf-a60a-33bf82290ea0/pixel.gif'
  )
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true })
  const delivered = await transport.sendMail({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Tracking test',
    ...body
  })
  const parsed = await simpleParser(delivered.message)

  assert.match(parsed.html || '', /<p>Tracked message<\/p>/)
  assert.match(
    parsed.html || '',
    /<img src="https:\/\/mail\.example\.com\/email-open\/822dcd01-802c-4bbf-a60a-33bf82290ea0\/pixel\.gif"/
  )
})
