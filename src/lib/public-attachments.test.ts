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
  assert.equal(
    attachmentContentDisposition('bad\r\nname\\.txt'),
    `attachment; filename="bad__name_.txt"; filename*=UTF-8''bad%0D%0Aname%5C.txt`
  )
  assert.equal(
    attachmentContentDisposition(''),
    `attachment; filename="attachment"; filename*=UTF-8''`
  )
})

test('preserves empty HTML when there are no attachments and formats size boundaries', () => {
  assert.equal(appendPublicAttachmentLinks(undefined, 'https://mail.example.com', []), null)
  assert.equal(
    appendPublicAttachmentLinks('  <p>Keep</p>  ', 'https://mail.example.com', []),
    '  <p>Keep</p>  '
  )

  const html = appendPublicAttachmentLinks('  <body>Hi</body>  ', 'https://mail.example.com/', [
    { token: 'one', name: `<&"'`, contentType: 'text/plain', size: 1023 },
    { token: 'two', name: 'kilobyte', contentType: 'text/plain', size: 1024 },
    { token: 'three', name: 'megabyte', contentType: 'text/plain', size: 1024 * 1024 }
  ])

  assert.equal(
    html,
    '<body>Hi<div><p><strong>Download attachments</strong></p><ul><li><a href="https://mail.example.com/attachments/one">&lt;&amp;&quot;&#39;</a> (1023 B)</li><li><a href="https://mail.example.com/attachments/two">kilobyte</a> (1.0 KB)</li><li><a href="https://mail.example.com/attachments/three">megabyte</a> (1.0 MB)</li></ul></div></body>'
  )
  assert.match(
    appendPublicAttachmentLinks(undefined, 'https://mail.example.com', [attachment]) ?? '',
    /^<div>/
  )
})
