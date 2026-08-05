import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ attachmentContentDisposition: vi.fn() }))

vi.mock('$lib/public-attachments', () => ({
  attachmentContentDisposition: state.attachmentContentDisposition
}))

import {
  ATTACHMENT_SECURITY_HEADERS,
  inlineAttachmentDisposition,
  isInlineSafeContentType
} from './attachment-response.ts'

beforeEach(() => {
  state.attachmentContentDisposition
    .mockReset()
    .mockImplementation((filename: string) => `download:${filename}`)
})

test('only permits explicitly safe normalized content types inline', () => {
  for (const contentType of [
    'image/gif',
    ' IMAGE/JPEG ; charset=binary ',
    'image/png',
    'image/webp',
    'image/avif',
    'application/pdf; charset=utf-8',
    'video/mp4'
  ]) {
    assert.equal(isInlineSafeContentType(contentType), true, contentType)
  }

  for (const contentType of [
    '',
    'text/plain',
    'text/html',
    'application/xhtml+xml',
    'application/xml',
    'image/svg+xml',
    'image/bmp',
    'image/png-malicious',
    'application/pdf-malicious',
    'video/'
  ]) {
    assert.equal(isInlineSafeContentType(contentType), false, contentType)
  }
  assert.equal(isInlineSafeContentType(' ; charset=utf-8'), false)
  assert.equal(isInlineSafeContentType(';'), false)
})

test('uses inline disposition only for requested safe content', () => {
  assert.equal(inlineAttachmentDisposition(true, 'image/png', 'photo.png'), 'inline')
  assert.equal(state.attachmentContentDisposition.mock.calls.length, 0)

  assert.equal(inlineAttachmentDisposition(false, 'image/png', 'photo.png'), 'download:photo.png')
  assert.equal(
    inlineAttachmentDisposition(true, 'image/svg+xml', 'diagram.svg'),
    'download:diagram.svg'
  )
  assert.deepEqual(state.attachmentContentDisposition.mock.calls, [['photo.png'], ['diagram.svg']])
})

test('exposes no-sniff header for every attachment response', () => {
  assert.deepEqual(ATTACHMENT_SECURITY_HEADERS, { 'X-Content-Type-Options': 'nosniff' })
})
