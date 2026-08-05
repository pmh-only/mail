import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  attachmentSignature,
  parseComposerAttachments,
  scoreAttachmentSafety,
  summarizeAttachments
} from './mail-attachments.ts'

test('accepts an attachment above the former size limit', () => {
  const size = 25 * 1024 * 1024 + 1
  const content = Buffer.alloc(size).toString('base64')
  const result = parseComposerAttachments([
    {
      name: 'large.bin',
      contentType: 'application/octet-stream',
      size,
      contentBase64: content,
      deliveryMode: 'mail'
    }
  ])

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.attachments[0].deliveryMode, 'mail')
})

test('preserves an explicit public-link delivery mode', () => {
  const result = parseComposerAttachments([
    {
      name: 'shared.txt',
      contentType: 'text/plain',
      size: 1,
      contentBase64: 'YQ==',
      deliveryMode: 'public'
    }
  ])

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.attachments[0].deliveryMode, 'public')
})

test('accepts a streamed public-link attachment reference without inline content', () => {
  const result = parseComposerAttachments([
    {
      name: 'one-gib.bin',
      contentType: 'application/octet-stream',
      size: 1024 ** 3,
      token: '67c5a06e-7ff2-49e4-9fa4-c182b4dc9161',
      deliveryMode: 'public'
    }
  ])

  assert.deepEqual(result, {
    ok: true,
    attachments: [
      {
        name: 'one-gib.bin',
        contentType: 'application/octet-stream',
        size: 1024 ** 3,
        token: '67c5a06e-7ff2-49e4-9fa4-c182b4dc9161',
        deliveryMode: 'public'
      }
    ]
  })
})

test('normalizes public references and accepts base64 data containing plus characters', () => {
  const result = parseComposerAttachments([
    {
      name: 'inline.bin',
      size: 3,
      contentBase64: ' +AAA\n',
      deliveryMode: 'mail'
    },
    {
      name: 'shared.bin',
      size: 0,
      token: ' public-upload-token ',
      deliveryMode: 'public'
    }
  ])

  assert.deepEqual(result, {
    ok: true,
    attachments: [
      {
        name: 'inline.bin',
        contentType: 'application/octet-stream',
        size: 3,
        contentBase64: '+AAA',
        deliveryMode: 'mail'
      },
      {
        name: 'shared.bin',
        contentType: 'application/octet-stream',
        size: 0,
        token: 'public-upload-token',
        deliveryMode: 'public'
      }
    ]
  })
})

test('requires inline content for a mail attachment', () => {
  const result = parseComposerAttachments([
    {
      name: 'mail.bin',
      contentType: 'application/octet-stream',
      size: 1,
      token: 'not-valid-for-mail',
      deliveryMode: 'mail'
    }
  ])

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /content is required/)
})

test('rejects an unknown attachment delivery mode', () => {
  const result = parseComposerAttachments([
    {
      name: 'shared.txt',
      contentType: 'text/plain',
      size: 1,
      contentBase64: 'YQ==',
      deliveryMode: 'unknown'
    }
  ])

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /delivery mode/)
})

test('keeps legacy attachment routing when delivery mode is absent', () => {
  const small = parseComposerAttachments([
    { name: 'small.txt', contentType: 'text/plain', size: 1, contentBase64: 'YQ==' }
  ])
  const largeSize = 5 * 1024 * 1024 + 1
  const large = parseComposerAttachments([
    {
      name: 'large.bin',
      contentType: 'application/octet-stream',
      size: largeSize,
      contentBase64: Buffer.alloc(largeSize).toString('base64')
    }
  ])

  assert.equal(small.ok, true)
  if (small.ok) assert.equal(small.attachments[0].deliveryMode, 'mail')
  assert.equal(large.ok, true)
  if (large.ok) assert.equal(large.attachments[0].deliveryMode, 'public')
})

test('scores attachment safety signals and avoids duplicate warnings', () => {
  assert.deepEqual(
    scoreAttachmentSafety({ filename: 'report.pdf', contentType: 'application/pdf', size: 1 }),
    {
      level: 'low',
      label: 'No attachment warning',
      reasons: []
    }
  )
  assert.deepEqual(
    scoreAttachmentSafety({ filename: 'invoice.pdf.exe', contentType: 'text/plain', size: 0 }),
    {
      level: 'high',
      label: 'High-risk attachment',
      reasons: [
        'Executable or script-like file extension',
        'Filename uses a double extension',
        'Attachment is empty'
      ]
    }
  )
  assert.equal(scoreAttachmentSafety({ filename: 'archive.zip' }).level, 'medium')
  assert.equal(scoreAttachmentSafety({ filename: 'invoice.pdf.doc' }).level, 'medium')
  assert.equal(
    scoreAttachmentSafety({ filename: 'macro.xlsm', size: 26 * 1024 * 1024 }).reasons.length,
    2
  )
  assert.equal(scoreAttachmentSafety({ filename: 'hidden\u0000.txt' }).level, 'high')
  assert.equal(scoreAttachmentSafety({ contentType: 'application/octet-stream' }).level, 'medium')
  assert.equal(
    scoreAttachmentSafety({ filename: 'photo.jpg', contentType: 'image/png' }).level,
    'medium'
  )
  assert.equal(
    scoreAttachmentSafety({ filename: 'report.pdf', contentType: 'application/octet-stream' })
      .level,
    'medium'
  )
})

test('creates stable attachment signatures and safe summaries', () => {
  const attachments = [
    {
      name: 'mail.txt',
      contentType: 'text/plain',
      size: 1,
      contentBase64: 'YQ==',
      deliveryMode: 'mail' as const
    },
    {
      name: 'public.txt',
      contentType: 'text/plain',
      size: 2,
      token: 'token',
      deliveryMode: 'public' as const
    },
    {
      name: 'empty-public.txt',
      contentType: 'text/plain',
      size: 0,
      deliveryMode: 'public' as const
    }
  ]

  assert.equal(
    attachmentSignature(attachments),
    'mail.txt:text/plain:1:YQ==:mail|public.txt:text/plain:2:token:public|empty-public.txt:text/plain:0::public'
  )
  assert.deepEqual(summarizeAttachments(attachments), [
    { name: 'mail.txt', contentType: 'text/plain', size: 1, deliveryMode: 'mail' },
    { name: 'public.txt', contentType: 'text/plain', size: 2, deliveryMode: 'public' },
    { name: 'empty-public.txt', contentType: 'text/plain', size: 0, deliveryMode: 'public' }
  ])
})

test('rejects malformed composer attachment payloads', () => {
  const invalid = (input: unknown, error: string) => {
    const result = parseComposerAttachments(input)
    assert.deepEqual(result, { ok: false, error })
  }

  assert.deepEqual(parseComposerAttachments(null), { ok: true, attachments: [] })
  invalid({}, 'Attachments must be an array')
  invalid(
    Array.from({ length: 11 }, () => ({})),
    'Too many attachments (max 10)'
  )
  invalid([null], 'Each attachment must be an object')
  invalid([{}], 'Attachment name is required')
  invalid([{ name: 'a', size: -1 }], 'Invalid size for attachment a')
  invalid([{ name: 'a', size: 1.5 }], 'Invalid size for attachment a')
  invalid([{ name: 'a', size: 1 }], 'Attachment content is required for a')
  invalid(
    [{ name: 'a', size: 1, contentBase64: 'abc' }],
    'Attachment content is not valid base64 for a'
  )
  invalid(
    [{ name: 'a', size: 1, contentBase64: 'YQ=A' }],
    'Attachment content is not valid base64 for a'
  )
  invalid(
    [{ name: 'a', size: 1, contentBase64: 'YQ=!' }],
    'Attachment content is not valid base64 for a'
  )
  invalid([{ name: 'a', size: 2, contentBase64: '/AAA' }], 'Attachment size mismatch for a')
  invalid([{ name: 'a', size: 2, contentBase64: 'YQ==' }], 'Attachment size mismatch for a')
  invalid(
    [{ name: 'a', size: 3, contentBase64: '_AAA' }],
    'Attachment content is not valid base64 for a'
  )
  invalid(
    [{ name: 'a', size: 3, contentBase64: '!AAA' }],
    'Attachment content is not valid base64 for a'
  )
  invalid(
    [{ name: 'a', size: 3, contentBase64: '{AAA' }],
    'Attachment content is not valid base64 for a'
  )
})
