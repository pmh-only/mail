import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  appendPublicAttachmentLinks,
  attachmentContentDisposition,
  publicAttachmentUrl
} from './public-attachments.ts'

const attachment = {
  token: 'opaque token',
  name: 'report & notes.pdf',
  contentType: 'application/pdf',
  size: 6 * 1024 * 1024
}

test('appends escaped public attachment links to an HTML fragment', () => {
  const html = appendPublicAttachmentLinks('<p>Hello</p>', 'https://mail.example.com/', [
    attachment
  ])

  assert.match(html ?? '', /^<p>Hello<\/p><div>/)
  assert.match(html ?? '', /href="https:\/\/mail\.example\.com\/attachments\/opaque%20token"/)
  assert.match(html ?? '', />report &amp; notes\.pdf<\/a> \(6\.0 MB\)/)
})

test('inserts links inside a complete HTML document body', () => {
  const html = appendPublicAttachmentLinks(
    '<html><body><p>Hello</p></body></html>',
    'https://mail.example.com',
    [attachment]
  )

  assert.match(html ?? '', /<p>Hello<\/p><div>.*<\/div><\/body><\/html>$/)
})

test('builds public URLs and safe Unicode download dispositions', () => {
  assert.equal(
    publicAttachmentUrl('https://mail.example.com/', 'opaque token'),
    'https://mail.example.com/attachments/opaque%20token'
  )
  assert.equal(
    attachmentContentDisposition('résumé "final".pdf'),
    `attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`
  )
})
