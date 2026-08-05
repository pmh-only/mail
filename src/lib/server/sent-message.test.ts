import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { ImapConfig, SmtpConfig } from './config'
import {
  findSentMailbox,
  findSentMailboxForAccount,
  messageIdFromRawMessage,
  selectSentImapConfig,
  storeSentMessage,
  withoutBccHeader
} from './sent-message.ts'

const smtpConfig: SmtpConfig = {
  id: 'server-2',
  name: 'Work SMTP',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  allowInvalidCertificate: false,
  user: 'work@example.com',
  password: 'secret',
  from: 'Work User <work@example.com>'
}

function imapConfig(id: string, user: string): ImapConfig {
  return {
    id,
    name: id,
    host: 'imap.example.com',
    port: 993,
    secure: true,
    allowInvalidCertificate: false,
    user,
    password: 'secret',
    mailbox: 'INBOX',
    pollSeconds: 15
  }
}

test('selects the matching IMAP account for a sent message', () => {
  const primary = imapConfig('primary', 'personal@example.com')
  const work = imapConfig('server-2', 'work@example.com')
  assert.equal(selectSentImapConfig(smtpConfig, [primary, work]), work)

  assert.equal(
    selectSentImapConfig({ ...smtpConfig, id: 'smtp-work' }, [primary, work]),
    work,
    'falls back to the sender address when server IDs differ'
  )
  assert.equal(
    selectSentImapConfig(
      { ...smtpConfig, id: 'unknown', user: 'unknown@example.com', from: 'unknown@example.com' },
      [primary, work]
    ),
    null,
    'does not save to the wrong account when no multi-account match exists'
  )
  const other = imapConfig('other', 'other@example.com')
  assert.equal(
    selectSentImapConfig({ ...smtpConfig, id: 'unknown', from: 'Other <OTHER@example.com>' }, [
      other
    ]),
    other,
    'uses the SMTP login when the From address differs'
  )
  assert.equal(selectSentImapConfig(smtpConfig, [primary]), primary)
})

test('prefers the IMAP special-use Sent mailbox and supports common fallbacks', () => {
  assert.equal(
    findSentMailbox([{ path: 'Sent' }, { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' }]),
    '[Gmail]/Sent Mail'
  )
  assert.equal(findSentMailbox([{ path: 'INBOX' }, { path: 'Sent Items' }]), 'Sent Items')
  assert.equal(
    findSentMailbox([{ path: 'INBOX' }, { path: 'Archive', flags: new Set(['\\Sent']) }]),
    'Archive'
  )
  assert.equal(findSentMailbox([{ path: 'INBOX' }]), null)
})

test('does not fall back to another account Sent mailbox', () => {
  const mailboxes = [
    { path: 'primary/INBOX', configId: 'primary' },
    { path: 'work/Sent', configId: 'work', specialUse: '\\Sent' }
  ]
  assert.equal(findSentMailboxForAccount(mailboxes, 'primary', 2), null)
  assert.equal(findSentMailboxForAccount(mailboxes, 'work', 2), 'work/Sent')
  assert.equal(findSentMailboxForAccount([{ path: 'Sent' }], 'primary', 1), 'Sent')
})

test('removes Bcc headers from SMTP delivery without changing the stored message body', () => {
  const raw = Buffer.from(
    'From: sender@example.com\r\nBcc: first@example.com,\r\n second@example.com\r\nSubject: Test\r\n\r\nBcc: body content\r\n',
    'utf8'
  )
  assert.equal(
    withoutBccHeader(raw).toString('utf8'),
    'From: sender@example.com\r\nSubject: Test\r\n\r\nBcc: body content\r\n'
  )
})

test('retains folded non-Bcc headers', () => {
  assert.equal(
    withoutBccHeader(Buffer.from('Subject: first\r\n second\r\n\r\nBody')).toString(),
    'Subject: first\r\n second\r\n\r\nBody'
  )
})

test('recovers a Message-ID from a previously built SMTP message', () => {
  assert.equal(
    messageIdFromRawMessage(
      Buffer.from('From: sender@example.com\r\nMessage-ID: <queued@mail.local>\r\n\r\nBody')
    ),
    '<queued@mail.local>'
  )
  assert.equal(messageIdFromRawMessage(Buffer.from('Subject: Missing\r\n\r\nBody')), null)
  assert.equal(
    messageIdFromRawMessage(Buffer.from('Message-ID: <first\r\n second>\r\n\r\nBody')),
    '<first second>'
  )
  assert.equal(messageIdFromRawMessage(Buffer.from('Message-ID: <header-only>')), '<header-only>')
})

test('supports LF messages and leaves headerless messages unchanged when removing Bcc', () => {
  assert.equal(
    withoutBccHeader(Buffer.from('Bcc: hidden@example.com\nSubject: Test\n\nBody')).toString(),
    'Subject: Test\n\nBody'
  )
  const raw = Buffer.from('Bcc: hidden@example.com')
  assert.equal(withoutBccHeader(raw), raw)
})

test('appends a seen Sent copy once and recognizes it on retry', async () => {
  let stored = false
  let appendCount = 0
  let releaseCount = 0
  const rawMessage = Buffer.from('X-Pmail-Smtp-Job-ID: 42\r\n\r\nHello')
  const deliveredAt = new Date('2026-07-21T10:00:00.000Z')
  const client = {
    async list() {
      return [{ path: 'INBOX' }, { path: 'Sent', specialUse: '\\Sent' }]
    },
    async getMailboxLock(mailbox: string) {
      assert.equal(mailbox, 'Sent')
      return { release: () => void (releaseCount += 1) }
    },
    async search(query: { header: Record<string, string> }) {
      assert.deepEqual(query.header, { 'X-Pmail-Smtp-Job-ID': '42' })
      return stored ? [101] : []
    },
    async append(mailbox: string, message: Buffer, flags: string[], date: Date) {
      assert.equal(mailbox, 'Sent')
      assert.equal(message, rawMessage)
      assert.deepEqual(flags, ['\\Seen'])
      assert.equal(date, deliveredAt)
      appendCount += 1
      stored = true
      return { uid: 101, uidValidity: 1n, seq: 1 }
    }
  }

  assert.equal(await storeSentMessage(client as never, rawMessage, 42, deliveredAt), 'Sent')
  assert.equal(await storeSentMessage(client as never, rawMessage, 42, deliveredAt), 'Sent')
  assert.equal(appendCount, 1)
  assert.equal(releaseCount, 2)
})

test('releases the mailbox lock when searching or appending fails', async () => {
  const release = vi.fn()
  const client = {
    list: vi.fn().mockResolvedValue([{ path: 'Sent', specialUse: '\\Sent' }]),
    getMailboxLock: vi.fn().mockResolvedValue({ release }),
    search: vi.fn().mockRejectedValue(new Error('network failure')),
    append: vi.fn()
  }

  await assert.rejects(
    storeSentMessage(client as never, Buffer.from(''), 4, new Date()),
    /network failure/
  )
  assert.equal(release.mock.calls.length, 1)
  assert.equal(client.append.mock.calls.length, 0)
})

test('reports unavailable Sent mailboxes and failed persistence', async () => {
  const noMailbox = { list: vi.fn().mockResolvedValue([]) }
  await assert.rejects(
    storeSentMessage(noMailbox as never, Buffer.from(''), 4, new Date()),
    /Sent mailbox not found/
  )

  const release = vi.fn()
  const client = {
    list: vi.fn().mockResolvedValue([{ path: 'Sent', specialUse: '\\Sent' }]),
    getMailboxLock: vi.fn().mockResolvedValue({ release }),
    search: vi.fn().mockResolvedValue(false),
    append: vi.fn()
  }
  await assert.rejects(
    storeSentMessage(client as never, Buffer.from(''), 5, new Date()),
    /Failed to search/
  )
  assert.equal(release.mock.calls.length, 1)

  client.search.mockResolvedValue([])
  client.append.mockResolvedValue(false)
  await assert.rejects(
    storeSentMessage(client as never, Buffer.from(''), 6, new Date()),
    /Failed to persist/
  )
  assert.equal(release.mock.calls.length, 2)
})
