import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildDraftMessage } from './draft-message.ts'

test('builds a complete draft MIME message with stable headers and attachments', async () => {
  const message = await buildDraftMessage(
    {
      id: 7,
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      toAddr: 'to@example.com',
      cc: '',
      bcc: '',
      subject: 'Draft subject',
      html: '<p>Draft body</p>',
      inReplyTo: null
    },
    'from@example.com',
    [
      {
        name: 'note.txt',
        contentType: 'text/plain',
        size: 5,
        contentBase64: Buffer.from('hello').toString('base64'),
        deliveryMode: 'mail'
      }
    ]
  )
  const raw = message.toString()
  assert.match(raw, /X-Pmail-Draft-ID: 7/i)
  assert.match(raw, /X-Pmail-Draft-Version: 2026-07-15T00:00:00\.000Z/i)
  assert.match(raw, /Subject: Draft subject/i)
  assert.match(raw, /filename=note\.txt/i)
  assert.match(raw, /Content-Type: multipart\/alternative/i)
  assert.match(raw, /Content-Type: text\/plain/i)
  assert.match(raw, /Content-Type: text\/html/i)
  assert.match(raw, /<!doctype html><html>/i)
})

test('does not embed public-link attachment content in the IMAP draft', async () => {
  const message = await buildDraftMessage(
    {
      id: 43,
      updatedAt: new Date('2026-07-23T12:00:00.000Z'),
      toAddr: 'receiver@example.com',
      cc: '',
      bcc: '',
      subject: 'Large file',
      html: '<p>Download the file after sending.</p>',
      inReplyTo: null
    },
    'sender@example.com',
    [
      {
        name: 'one-gib.bin',
        contentType: 'application/octet-stream',
        size: 1024 ** 3,
        token: '67c5a06e-7ff2-49e4-9fa4-c182b4dc9161',
        deliveryMode: 'public'
      }
    ]
  )

  assert.doesNotMatch(message.toString(), /one-gib\.bin/)
})
