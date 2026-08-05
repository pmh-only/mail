import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import type { SmtpConfig } from './config'

const state = vi.hoisted(() => ({
  outgoingMessageBody: vi.fn(),
  outgoingSenderAddress: vi.fn(),
  sendStatusFromJobStatus: vi.fn()
}))

vi.mock('./outgoing-message.ts', () => ({
  outgoingMessageBody: state.outgoingMessageBody,
  outgoingSenderAddress: state.outgoingSenderAddress
}))
vi.mock('../send-status.ts', () => ({ sendStatusFromJobStatus: state.sendStatusFromJobStatus }))
import {
  createSentPlaceholder,
  sentPlaceholderDetail,
  sentPlaceholderId,
  smtpJobIdFromPlaceholder
} from './sent-placeholder.ts'

beforeEach(() => {
  state.outgoingMessageBody.mockReset().mockReturnValue({ text: 'Converted message' })
  state.outgoingSenderAddress.mockReset().mockReturnValue('sender@example.com')
  state.sendStatusFromJobStatus
    .mockReset()
    .mockImplementation((status: string, deliveredAt?: Date) => {
      if (deliveredAt || status === 'done') return 'sent'
      if (status === 'failed') return 'failed'
      return status === 'pending' || status === 'running' ? 'sending' : null
    })
})

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
  assert.equal(placeholder.preview, 'Converted message')
  assert.equal(placeholder.flags, '["\\\\Seen"]')

  const detail = sentPlaceholderDetail(placeholder, job)
  assert.equal(detail.textContent, 'Converted message')
  assert.equal(detail.htmlContent, '<p>Hello <strong>there</strong></p>')
})

test('selects a configured SMTP server and validates placeholder input', async () => {
  const { parseSentPlaceholderPayload, smtpConfigForPlaceholder } =
    await import('./sent-placeholder.ts')
  assert.deepEqual(
    parseSentPlaceholderPayload({
      id: 1,
      payload: 'null',
      status: 'pending',
      messageId: null,
      createdAt: new Date()
    }),
    null
  )
  assert.deepEqual(
    parseSentPlaceholderPayload({
      id: 1,
      payload: '[]',
      status: 'pending',
      messageId: null,
      createdAt: new Date()
    }),
    []
  )
  assert.equal(smtpConfigForPlaceholder({ smtpServerId: 'primary' }, [smtpConfig]), smtpConfig)
  assert.equal(smtpConfigForPlaceholder({}, [smtpConfig]), smtpConfig)
  assert.equal(smtpConfigForPlaceholder({ smtpServerId: 'missing' }, [smtpConfig]), null)
  assert.equal(smtpConfigForPlaceholder({}, []), null)
})

test('falls back to subject and default sender for incomplete payload fields', () => {
  state.outgoingMessageBody.mockReturnValue({})
  const job = {
    id: 8,
    payload: JSON.stringify({ subject: 1, html: 2, to: 3, cc: 4, fromName: '  Name  ' }),
    status: 'pending',
    messageId: '<id>',
    createdAt: new Date(),
    openedAt: undefined
  }
  const placeholder = createSentPlaceholder(job, 'Sent', null)
  assert.ok(placeholder)
  assert.equal(placeholder.subject, '')
  assert.equal(placeholder.preview, '')
  assert.equal(placeholder.from, 'Me')
  assert.equal(placeholder.to, '')
  assert.equal(placeholder.cc, '')
  assert.equal(placeholder.openedAt, null)
  assert.equal(
    sentPlaceholderDetail({ ...placeholder, subject: 'Fallback' }, job).textContent,
    'Fallback'
  )
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
  assert.equal(smtpJobIdFromPlaceholder(0), null)
})
