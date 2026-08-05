import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { SmtpConfig } from './config'
import {
  createSentPlaceholder,
  sentPlaceholderDetail,
  sentPlaceholderId,
  smtpJobIdFromPlaceholder
} from './sent-placeholder.ts'

const smtpConfig: SmtpConfig = {
  id: 'primary',
  name: 'Primary',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  allowInvalidCertificate: false,
  user: 'sender@example.com',
  password: 'secret',
  from: 'Sender <sender@example.com>'
}

test('builds a Sent placeholder with a UI-only ID and live sending status', () => {
  const job = {
    id: 42,
    payload: JSON.stringify({
      to: 'recipient@example.com',
      cc: 'copy@example.com',
      subject: 'Status test',
      html: '<p>Hello <strong>there</strong></p>',
      smtpServerId: 'primary',
      fromName: 'Custom Sender'
    }),
    status: 'running',
    messageId: '<pmail-test@mail.local>',
    createdAt: new Date('2026-07-22T10:00:00.000Z')
  }

  const placeholder = createSentPlaceholder(job, 'Sent', smtpConfig)
  assert.ok(placeholder)
  assert.equal(placeholder.id, -42)
  assert.equal(placeholder.sendStatus, 'sending')
  assert.equal(placeholder.from, 'Custom Sender <sender@example.com>')
  assert.equal(placeholder.preview, 'Hello there')
  assert.equal(placeholder.flags, '["\\\\Seen"]')

  const detail = sentPlaceholderDetail(placeholder, job)
  assert.equal(detail.textContent, 'Hello there')
  assert.equal(detail.htmlContent, '<p>Hello <strong>there</strong></p>')
})

test('maps terminal job states and ignores canceled or malformed jobs', () => {
  const base = {
    id: 7,
    payload: JSON.stringify({ to: 'recipient@example.com', subject: 'Test' }),
    messageId: '<pmail-state@mail.local>',
    createdAt: new Date()
  }
  assert.equal(
    createSentPlaceholder({ ...base, status: 'failed' }, 'Sent', null)?.sendStatus,
    'failed'
  )
  assert.equal(createSentPlaceholder({ ...base, status: 'done' }, 'Sent', null)?.sendStatus, 'sent')
  assert.equal(
    createSentPlaceholder(
      { ...base, status: 'failed', deliveredAt: new Date('2026-07-22T10:00:00.000Z') },
      'Sent',
      null
    )?.sendStatus,
    'sent',
    'delivery remains sent when only Sent-copy persistence fails'
  )
  assert.equal(createSentPlaceholder({ ...base, status: 'canceled' }, 'Sent', null), null)
  assert.equal(
    createSentPlaceholder({ ...base, status: 'pending', payload: '{' }, 'Sent', null),
    null
  )
})

test('round-trips SMTP job IDs through negative placeholder IDs', () => {
  assert.equal(sentPlaceholderId(91), -91)
  assert.equal(smtpJobIdFromPlaceholder(-91), 91)
  assert.equal(smtpJobIdFromPlaceholder(91), null)
  assert.equal(smtpJobIdFromPlaceholder(-1.5), null)
})
