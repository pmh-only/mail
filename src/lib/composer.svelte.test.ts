import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeComposer,
  composer,
  invalidateSignatureCache,
  openCompose,
  openDraft,
  openForward,
  openReply,
  openReplyAll,
  type ComposerMessage
} from './composer.svelte'

const message: ComposerMessage = {
  id: 1,
  messageId: '<message@example.com>',
  from: 'Alice <alice@example.com>',
  to: 'owner@example.com, Alice <alice@example.com>',
  subject: 'Subject',
  htmlContent: '<p>Original</p>',
  textContent: 'Original text',
  receivedAt: '2026-08-10T08:00:00.000Z'
}

describe('composer state', () => {
  beforeEach(() => {
    invalidateSignatureCache()
    vi.stubGlobal('fetch', vi.fn())
    Object.assign(composer, {
      open: false,
      minimized: true,
      fullscreen: true,
      smtpServers: []
    })
  })

  it('opens compose with escaped text, default signature, and valid SMTP servers', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        signatureProfiles: [
          { id: 1, name: 'Other', html: '<p>Other</p>', isDefault: false },
          { id: 2, name: 'Main', html: '<p>Signature</p>', isDefault: true }
        ],
        smtpServers: [
          { id: ' main ', name: ' Primary ', from: ' sender@example.com ' },
          { id: 'fallback', name: ' ', from: 'fallback@example.com' },
          { id: '', name: 'Invalid', from: 'none@example.com' },
          { id: 1, name: null, from: false }
        ]
      })
    )
    await openCompose({
      to: 'to@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Hello',
      body: `<&> "quote" 'single'\nnext`
    })
    expect(composer).toMatchObject({
      mode: 'compose',
      to: 'to@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Hello',
      selectedSignatureId: 2,
      currentSignatureHtml: '<p>Signature</p>',
      selectedSmtpServerId: 'main',
      open: true,
      minimized: false,
      fullscreen: false
    })
    expect(composer.initialHtml).toBe(
      '<p>&lt;&amp;&gt; &quot;quote&quot; &#039;single&#039;<br>next</p><p></p><p>Signature</p>'
    )
    expect(composer.smtpServers).toEqual([
      { id: 'main', name: 'Primary', from: 'sender@example.com' },
      { id: 'fallback', name: 'fallback', from: 'fallback@example.com' }
    ])
  })

  it('uses the first signature when none is marked default', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        signatureProfiles: [{ id: 3, name: 'First', html: '<p>First</p>', isDefault: false }]
      })
    )
    await openCompose()
    expect(composer.selectedSignatureId).toBe(3)
    expect(composer.initialHtml).toBe('<p></p><p>First</p>')
  })

  it('supports legacy, empty, malformed, and unavailable settings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ signature: '<p>Legacy</p>' }))
    await openCompose()
    expect(composer.signatureProfiles[0]).toMatchObject({ id: 0, name: 'Default', isDefault: true })
    expect(composer.initialHtml).toContain('Legacy')

    invalidateSignatureCache()
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ signatureProfiles: 'bad', smtpServers: 'bad' })
    )
    await openCompose()
    expect(composer.signatureProfiles).toEqual([])
    expect(composer.smtpServers).toEqual([])

    invalidateSignatureCache()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    await openCompose()
    expect(composer.signatureProfiles).toEqual([])

    invalidateSignatureCache()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    await openCompose()
    expect(composer.signatureProfiles).toEqual([])
  })

  it('caches loaded composer settings until invalidated', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ signature: '<p>Cached</p>' }))
    await openCompose()
    await openCompose()
    expect(fetch).toHaveBeenCalledOnce()
    invalidateSignatureCache()
    await openCompose()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('opens replies with HTML and normalized metadata', () => {
    openReply(message)
    expect(composer.mode).toBe('reply')
    expect(composer.to).toBe('Alice <alice@example.com>')
    expect(composer.subject).toBe('Re: Subject')
    expect(composer.inReplyTo).toBe('<message@example.com>')
    expect(composer.initialHtml).toContain('Alice &lt;alice@example.com&gt; wrote:')
    expect(composer.initialHtml).toContain('<p>Original</p>')
  })

  it('preserves reply prefixes and prepends a draft', () => {
    openReply({ ...message, subject: 'Re: Existing' }, '<p>Draft</p>')
    expect(composer.subject).toBe('Re: Existing')
    expect(composer.initialHtml).toMatch(/^<p>Draft<\/p><blockquote/)
  })

  it('builds text-only and anonymous replies', () => {
    openReply({
      ...message,
      from: 'plain@example.com',
      subject: null,
      htmlContent: null,
      textContent: 'one\ntwo',
      receivedAt: null,
      messageId: undefined
    })
    expect(composer.subject).toBe('Re: ')
    expect(composer.inReplyTo).toBeNull()
    expect(composer.initialHtml).toContain('&lt;plain@example.com&gt; wrote:')
    expect(composer.initialHtml).toContain('<p>one<br>two</p>')

    openReply({ ...message, from: null, htmlContent: null, textContent: null })
    expect(composer.to).toBe('')
    expect(composer.initialHtml).toContain('&lt;&gt; wrote:')

    openReply({ ...message, from: ' <hidden@example.com>' })
    expect(composer.initialHtml).toContain(' &lt;hidden@example.com&gt;')
  })

  it('opens reply-all and excludes the sender from Cc', () => {
    openReplyAll(message, '   ')
    expect(composer.mode).toBe('reply-all')
    expect(composer.to).toBe(message.from)
    expect(composer.cc).toBe('owner@example.com')

    openReplyAll({
      ...message,
      from: null,
      to: null,
      subject: 'Re: Existing',
      messageId: undefined
    })
    expect(composer.to).toBe('')
    expect(composer.cc).toBe('')
    expect(composer.subject).toBe('Re: Existing')
    expect(composer.inReplyTo).toBeNull()

    openReplyAll({ ...message, subject: null })
    expect(composer.subject).toBe('Re: ')
  })

  it('opens forwards with HTML or text and preserves existing prefixes', () => {
    openForward(message)
    expect(composer.mode).toBe('forward')
    expect(composer.subject).toBe('Fwd: Subject')
    expect(composer.initialHtml).toContain('---------- Forwarded message ----------')
    expect(composer.initialHtml).toContain('<p>Original</p>')

    openForward({
      ...message,
      subject: 'Fwd: Existing',
      from: null,
      to: null,
      receivedAt: null,
      htmlContent: null,
      textContent: 'line one\nline two'
    })
    expect(composer.subject).toBe('Fwd: Existing')
    expect(composer.initialHtml).toContain('<p>line one<br>line two</p>')

    openForward({ ...message, subject: null, htmlContent: null, textContent: null })
    expect(composer.subject).toBe('Fwd: ')
    expect(composer.initialHtml).toMatch(/<p><\/p>$/)
  })

  it('opens a full draft and applies optional security settings', () => {
    composer.smtpServers = [{ id: 'default', name: 'Default', from: 'sender@example.com' }]
    openDraft({
      id: 8,
      toAddr: 'to@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Draft',
      html: '<p>Draft</p>',
      attachments: [
        {
          name: 'file.txt',
          contentType: 'text/plain',
          size: 4,
          deliveryMode: 'mail',
          contentBase64: 'ZmlsZQ=='
        }
      ],
      inReplyTo: '<reply>',
      smtpServerId: 'custom',
      fromName: 'Alice',
      openPgpSigning: 'pgp-mime',
      openPgpEncrypt: true,
      attachPublicKey: true,
      updatedAt: '2026-08-10T08:00:00Z'
    })
    expect(composer).toMatchObject({
      draftId: 8,
      selectedSmtpServerId: 'custom',
      fromName: 'Alice',
      openPgpSigning: 'pgp-mime',
      openPgpEncrypt: true,
      attachPublicKey: true,
      open: true
    })
    expect(composer.lastSavedAt).toBe(Date.parse('2026-08-10T08:00:00Z'))
  })

  it('uses draft defaults when optional settings are absent', () => {
    composer.smtpServers = [{ id: 'default', name: 'Default', from: 'sender@example.com' }]
    openDraft({
      id: 9,
      toAddr: '',
      cc: '',
      bcc: '',
      subject: '',
      html: '',
      attachments: [],
      inReplyTo: null,
      updatedAt: 'invalid'
    })
    expect(composer.selectedSmtpServerId).toBe('default')
    expect(composer.fromName).toBe('')
    expect(composer.openPgpSigning).toBe('none')
    expect(composer.openPgpEncrypt).toBe(false)
    expect(composer.attachPublicKey).toBe(false)

    composer.smtpServers = []
    openDraft({
      id: 10,
      toAddr: '',
      cc: '',
      bcc: '',
      subject: '',
      html: '',
      attachments: [],
      inReplyTo: null,
      updatedAt: 'invalid'
    })
    expect(composer.selectedSmtpServerId).toBe('')
  })

  it('closes and clears transient composer state', () => {
    Object.assign(composer, {
      open: true,
      fullscreen: true,
      draftId: 4,
      attachments: [
        {
          name: 'file.txt',
          contentType: 'text/plain',
          size: 1,
          deliveryMode: 'mail',
          contentBase64: 'YQ=='
        }
      ]
    })
    closeComposer()
    expect(composer.open).toBe(false)
    expect(composer.fullscreen).toBe(false)
    expect(composer.draftId).toBeNull()
    expect(composer.attachments).toEqual([])
  })
})
