import assert from 'node:assert/strict'
import test from 'node:test'
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
        contentBase64: Buffer.from('hello').toString('base64')
      }
    ]
  )
  const raw = message.toString()
  assert.match(raw, /X-Pmail-Draft-ID: 7/i)
  assert.match(raw, /X-Pmail-Draft-Version: 2026-07-15T00:00:00\.000Z/i)
  assert.match(raw, /Subject: Draft subject/i)
  assert.match(raw, /filename=note\.txt/i)
})
