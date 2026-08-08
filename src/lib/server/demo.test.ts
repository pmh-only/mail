import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import {
  commitDemoPublicAttachments,
  countDemoSearchMessages,
  countDemoSharedMessageReads,
  countDemoStoredMessages,
  countDemoStoredThreads,
  createDemoFilter,
  createDemoMessageTemplate,
  createDemoSenderRule,
  createDemoShareToken,
  createDemoThreadShareToken,
  createDemoFilters,
  deleteDemoContact,
  deleteDemoContactGroup,
  deleteDemoDraft,
  deleteDemoFilter,
  deleteDemoMessageTemplate,
  deleteDemoPublicAttachments,
  deleteDemoSenderRule,
  findDemoContactByEmail,
  generateDemoAiCompose,
  generateDemoAiReplyDraft,
  generateDemoRecentSummary,
  generateDemoThreadActions,
  generateDemoThreadSummary,
  generateDemoTranslations,
  generateDemoVapidKeys,
  getDemoAttachment,
  getDemoAuthSession,
  getDemoContactById,
  getDemoDisplayConfig,
  getDemoDraft,
  getDemoImapConfig,
  getDemoImapMailboxes,
  getDemoMailboxSyncStatus,
  getDemoMessageByShareToken,
  getDemoMessagesInThread,
  getDemoOidcConfig,
  getDemoPublicAttachment,
  getDemoSharedAttachment,
  getDemoSharedMessagesByShareToken,
  getDemoSignatureProfiles,
  getDemoSmtpConfig,
  getDemoStoredMessageById,
  getDemoSyncSummary,
  getDemoUnreadCount,
  getDemoUnreadCounts,
  getDemoVapidPublicKey,
  importDemoContactsFromMessages,
  isDemoModeEnabled,
  listDemoAttachmentsForMessage,
  listDemoAttachmentsForMessages,
  listDemoContactGroups,
  listDemoContacts,
  listDemoDrafts,
  listDemoFilters,
  listDemoMessageTemplates,
  listDemoMessagesForContact,
  listDemoSenderRules,
  listDemoStoredMessages,
  listDemoStoredThreads,
  markDemoMailboxMessagesSeen,
  markDemoMessageAsRead,
  markDemoMessageAsUnread,
  markDemoMessagesSeen,
  markDemoShareTokenAsRead,
  moveDemoMessage,
  registerDemoPublicAttachment,
  reorderDemoFilters,
  resetDemoState,
  saveDemoContactGroup,
  saveDemoDraft,
  saveDemoSettings,
  searchDemoMessages,
  searchDemoMessagesByRegex,
  sendDemoMessage,
  snoozeDemoMessages,
  splitDemoThreadFromMessage,
  storeDemoPublicAttachments,
  uncommitDemoPublicAttachments,
  updateDemoContact,
  updateDemoFilter,
  updateDemoMessageTemplate,
  upsertDemoContacts
} from './demo.ts'

beforeEach(resetDemoState)
afterEach(resetDemoState)

describe('demo mode configuration and mailbox data', () => {
  it('identifies demo mode and exposes masked, independently mutable configuration', () => {
    assert.equal(isDemoModeEnabled(), true)
    assert.deepEqual(getDemoAuthSession().user.email, 'demo@example.com')
    assert.equal(getDemoAuthSession().session.userId, 'demo-user')

    const display = getDemoDisplayConfig()
    assert.equal(display.imap.password, '••••••••')
    assert.equal(display.smtp.password, '••••••••')
    assert.equal(display.oidc.clientSecret, '••••••••')
    assert.equal(display.secretStorage.configured, false)
    display.signatureProfiles[0].name = 'Changed outside'
    display.imapServers[0].host = 'Changed outside'
    display.smtpServers[0].host = 'Changed outside'
    assert.equal(getDemoSignatureProfiles()[0].name, 'Default')
    assert.equal(getDemoDisplayConfig().imapServers[0].host, 'demo-imap.local')
    assert.equal(getDemoDisplayConfig().smtpServers[0].host, 'demo-smtp.local')

    saveDemoSettings({
      signature: '<p>Updated</p>',
      signatureProfiles: [{ name: ' Work ', html: '<p>Work</p>' }],
      imap: {
        host: ' imap.example.com ',
        port: 143,
        secure: false,
        allowInvalidCertificate: true,
        user: ' user@example.com ',
        password: 'new-imap-password',
        mailbox: ' Archive ',
        pollSeconds: 30
      },
      smtp: {
        host: ' smtp.example.com ',
        port: 465,
        secure: true,
        allowInvalidCertificate: true,
        user: ' sender@example.com ',
        password: 'new-smtp-password',
        from: ' Sender <sender@example.com> ',
        undoSendSeconds: 99
      },
      openai: { apiKey: ' key ', model: ' model ', importanceClassification: false },
      oidc: { issuer: ' https://issuer ', clientId: ' client ', clientSecret: 'secret' },
      github: { clientId: ' github ', clientSecret: 'github-secret' },
      discord: { clientId: ' discord ', clientSecret: 'discord-secret' },
      quietHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' }
    })

    assert.deepEqual(
      getDemoSignatureProfiles().map(({ name, html, isDefault }) => ({ name, html, isDefault })),
      [{ name: 'Work', html: '<p>Work</p>', isDefault: true }]
    )
    assert.equal(getDemoDisplayConfig().signature, '<p>Work</p>')
    assert.deepEqual(getDemoDisplayConfig().imapServers, [getDemoDisplayConfig().imap])
    assert.deepEqual(getDemoDisplayConfig().smtpServers, [getDemoDisplayConfig().smtp])
    assert.deepEqual(getDemoImapConfig(), {
      ...getDemoImapConfig(),
      host: 'imap.example.com',
      port: 143,
      secure: false,
      password: 'new-imap-password',
      mailbox: 'Archive',
      pollSeconds: 30
    })
    assert.equal(getDemoSmtpConfig().undoSendSeconds, 30)
    assert.equal(getDemoOidcConfig().issuer, 'https://issuer')
    assert.equal(getDemoDisplayConfig().openai.apiKey, '••••••••')

    saveDemoSettings({ openai: { clearApiKey: true }, imap: { password: '••••••••' } })
    assert.equal(getDemoDisplayConfig().openai.apiKey, '')
    assert.equal(getDemoImapConfig().password, 'new-imap-password')
  })

  it('recognizes every enabled demo-mode value and preserves explicit valid settings', async () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      vi.doMock('$env/dynamic/private', () => ({ env: { DEMO_MODE: value } }))
      vi.resetModules()
      assert.equal((await import('./demo.ts')).isDemoModeEnabled(), true)
    }
    vi.doMock('$env/dynamic/private', () => ({ env: { DEMO_MODE: 'false' } }))
    vi.resetModules()
    assert.equal((await import('./demo.ts')).isDemoModeEnabled(), false)
    vi.doUnmock('$env/dynamic/private')
    vi.resetModules()

    saveDemoSettings({
      signatureProfiles: [{ id: 12, name: 'Named', html: '<p>Named</p>', isDefault: true }]
    })
    assert.deepEqual(
      getDemoSignatureProfiles().map((profile) => profile.id),
      [12]
    )
  })

  it('lists, counts, searches, reads, snoozes, moves, and splits messages by mailbox and thread', () => {
    assert.deepEqual(
      getDemoImapMailboxes().map((mailbox) => mailbox.path),
      ['Inbox', 'Sent', 'Archive', 'Trash', 'Spam']
    )
    assert.equal(getDemoUnreadCounts().Inbox, 5)
    assert.equal(getDemoUnreadCount('Sent'), 0)
    assert.equal(getDemoUnreadCount(), 5)
    assert.equal(countDemoStoredMessages('Inbox'), 8)
    assert.equal(countDemoStoredMessages('Inbox', true), 5)
    assert.equal(countDemoStoredThreads('Inbox'), 6)
    assert.equal(countDemoStoredThreads('Inbox', true), 5)
    assert.equal(listDemoStoredMessages('Sent')[0].flags, '["\\\\Seen"]')
    assert.equal(listDemoStoredMessages('Sent', 10, 0, true).length, 0)
    assert.equal(listDemoStoredThreads('Sent', 10, 0, true).length, 0)
    assert.equal(
      listDemoStoredThreads('Inbox').find((row) => row.threadId === 'thread-demo-launch')
        ?.threadCount,
      2
    )

    assert.equal(searchDemoMessages('checklist?', 10, 0).length, 0)
    assert.equal(searchDemoMessages('checklist', 1, 0)[0].id, 103)
    assert.equal(searchDemoMessagesByRegex('customer|\\[M\\]etrics', 10).length, 3)
    assert.equal(countDemoSearchMessages('pilot'), 1)
    assert.equal(getDemoStoredMessageById('101')?.subject, 'Welcome to demo mode')
    assert.ok((getDemoStoredMessageById('112')?.textContent.length ?? 0) > 5_000)
    assert.match(getDemoStoredMessageById('112')?.htmlContent ?? '', /<h2>The next morning<\/h2>/)
    assert.equal(getDemoStoredMessageById('missing'), null)

    assert.equal(markDemoMessagesSeen([101, 110], true), 1)
    assert.equal(markDemoMessagesSeen([101], true), 0)
    markDemoMessageAsUnread({ id: 101 })
    assert.equal(getDemoStoredMessageById(101)?.flags, '[]')
    assert.equal(markDemoMailboxMessagesSeen(['Inbox']), 5)
    assert.equal(getDemoUnreadCount('Inbox'), 0)
    assert.equal(countDemoStoredThreads('Inbox', true), 0)
    assert.equal(markDemoMessagesSeen([110], false), 0)
    markDemoMessageAsRead({ id: 101 })
    assert.equal(markDemoMailboxMessagesSeen(['Inbox']), 0)

    assert.equal(snoozeDemoMessages([101, 999], new Date(Date.now() + 60_000)), 1)
    assert.equal(countDemoStoredMessages('Inbox'), 7)
    assert.equal(snoozeDemoMessages([101], null), 1)
    assert.equal(snoozeDemoMessages([101], new Date(Date.now() + 60_000)), 1)
    assert.equal(
      listDemoStoredMessages('Inbox').some((message) => message.id === 101),
      false
    )
    assert.equal(snoozeDemoMessages([101], null), 1)
    assert.equal(moveDemoMessage({ id: 101, mailbox: 'Inbox' }, 'archive'), 'Archive')
    assert.equal(moveDemoMessage({ id: 101, mailbox: 'Archive' }, 'archive'), null)
    assert.equal(moveDemoMessage({ id: 101, mailbox: 'Archive' }, 'spam'), 'Spam')
    assert.equal(listDemoStoredMessages('Spam')[0].flags, '["\\\\Seen"]')
    assert.equal(listDemoStoredThreads('Inbox', 10, 0, true).length, 0)

    const split = splitDemoThreadFromMessage('thread-demo-launch', 'Inbox', 103)
    assert.ok(split?.threadKey.startsWith('<demo-3@mail.local>#split-'))
    assert.deepEqual(
      { splitCount: split?.splitCount, remainingCount: split?.remainingCount },
      { splitCount: 1, remainingCount: 1 }
    )
    assert.equal(splitDemoThreadFromMessage('thread-demo-launch', 'Inbox', 102), null)
    assert.equal(splitDemoThreadFromMessage('missing', 'Inbox', 102), null)
    assert.equal(countDemoStoredMessages('Sent', true), 0)
    assert.equal(countDemoStoredThreads('Sent', true), 0)
    assert.deepEqual(getDemoMessagesInThread('missing', 'Inbox'), [])
  })

  it('returns sync status and stable generated summaries, actions, and translations', () => {
    assert.deepEqual(Object.keys(getDemoSyncSummary()), [
      'syncing',
      'configured',
      'hasError',
      'lastSyncedAt',
      'errorMessage',
      'progress'
    ])
    assert.equal(getDemoMailboxSyncStatus('Inbox').storedCount, 8)
    assert.equal(getDemoMailboxSyncStatus('Unknown').reason, 'Demo data is preloaded.')
    assert.match(generateDemoRecentSummary('Inbox', 'English', 2), /latest 2 messages/)
    assert.match(generateDemoRecentSummary('Unknown', 'English', 2), /No recent mail/)
    assert.match(generateDemoRecentSummary('Inbox', '한국어', 1), /데모 요약/)
    assert.match(generateDemoThreadSummary('Inbox', 'thread-demo-launch', 'ko') ?? '', /요약/)
    assert.equal(generateDemoThreadSummary('Inbox', 'unknown', 'English'), null)
    assert.equal(generateDemoThreadActions('Inbox', 'unknown'), null)
    assert.equal(
      generateDemoThreadActions('Inbox', 'thread-demo-launch')?.[0].sourceMessageId,
      '<demo-3@mail.local>'
    )
    assert.deepEqual(generateDemoTranslations([' Hello ', ''], 'Korean'), ['[데모 번역] Hello', ''])
    assert.match(
      generateDemoAiCompose({
        mode: 'reply',
        subject: '',
        html: '',
        to: '',
        rewriteMode: 'formal'
      }),
      /more formal/
    )
    assert.match(
      generateDemoAiReplyDraft(
        [],
        { from: 'Alex <alex@example.com>', preview: 'Status update', subject: null },
        true
      ),
      /Looping everyone/
    )
    assert.equal(getDemoVapidPublicKey(), null)
    assert.deepEqual(generateDemoVapidKeys(), {
      publicKey: 'demo-mode-disabled',
      subject: 'Demo mode disables live push delivery.'
    })
  })
})

describe('demo mode contacts, drafts, filters, and templates', () => {
  it('upserts, groups, imports, updates, and deletes contacts', async () => {
    await upsertDemoContacts([
      {
        name: ' Alex Updated ',
        email: ' ALEX@EXAMPLE.COM ',
        source: 'auto',
        useCount: 2,
        lastUsedAt: new Date('2020-01-01')
      },
      {
        name: 'New Person',
        email: 'NEW@example.com',
        source: 'manual',
        useCount: -2,
        lastUsedAt: null
      },
      { name: 'Ignored', email: '  ' }
    ])
    await upsertDemoContacts([
      { name: 'Nina Updated', email: 'nina@example.com', useCount: 0, lastUsedAt: null },
      { name: 'No Count', email: 'no-count@example.com' },
      { name: 'No Last Use', email: 'no-last-use@example.com', useCount: 0, lastUsedAt: null }
    ])
    assert.equal(findDemoContactByEmail('alex@example.com')?.name, 'Alex Updated')
    assert.equal(findDemoContactByEmail('new@example.com')?.useCount, 0)
    assert.equal(findDemoContactByEmail('missing@example.com'), null)
    assert.equal(findDemoContactByEmail('no-count@example.com')?.useCount, 1)
    assert.equal(getDemoContactById(302)?.name, 'Nina Updated')
    assert.equal(listDemoContacts('new')[0].display, 'New Person <new@example.com>')
    assert.equal(getDemoContactById(999), null)
    assert.equal(listDemoMessagesForContact('alex@example.com').length, 3)

    const group = saveDemoContactGroup({
      name: ' Team ',
      description: ' Core ',
      contactIds: [301, 301, -1, 999]
    })
    assert.deepEqual(
      { name: group.name, description: group.description, display: group.display },
      { name: 'Team', description: 'Core', display: 'Team (1)' }
    )
    const updated = saveDemoContactGroup({ id: group.id, name: ' Updated ', contactIds: [302] })
    assert.equal(updated.members[0].email, 'nina@example.com')
    assert.equal(listDemoContactGroups('updated').length, 1)
    deleteDemoContactGroup(group.id)
    assert.equal(listDemoContactGroups().length, 0)

    assert.ok((await importDemoContactsFromMessages()) > 0)
    const changed = updateDemoContact(301, {
      name: 'Alex Manual',
      email: 'alex+manual@example.com'
    })
    assert.equal(changed?.source, 'manual')
    assert.equal(updateDemoContact(999, { name: '', email: '' }), null)
    deleteDemoContact(301)
    assert.equal(getDemoContactById(301), null)

    await upsertDemoContacts([
      { name: 'Zed', email: 'zed@example.com', useCount: 100, lastUsedAt: null },
      { name: 'Amy', email: 'amy@example.com', useCount: 100, lastUsedAt: null }
    ])
    assert.deepEqual(
      listDemoContacts('', 2).map((contact) => contact.email),
      ['amy@example.com', 'zed@example.com']
    )

    saveDemoContactGroup({ name: 'Zulu', contactIds: [] })
    saveDemoContactGroup({ name: 'Alpha', contactIds: [] })
    assert.deepEqual(
      listDemoContactGroups().map((group) => group.name),
      ['Alpha', 'Zulu']
    )
  })

  it('creates, updates, sorts, and deletes drafts, filters, templates, and sender rules', () => {
    const draft = saveDemoDraft({ to: 'to@example.com', subject: 'New', html: '<p>New</p>' }, '[1]')
    assert.equal(getDemoDraft(draft.id)?.attachments, '[1]')
    saveDemoDraft({ id: draft.id, subject: 'Updated', inReplyTo: '<message>' }, '[]')
    assert.equal(getDemoDraft(draft.id)?.subject, 'Updated')
    assert.equal(listDemoDrafts()[0].id, draft.id)
    deleteDemoDraft(draft.id)
    assert.equal(getDemoDraft(draft.id), null)
    const fullDraft = saveDemoDraft(
      { to: 'to@example.com', cc: 'cc@example.com', bcc: 'bcc@example.com', inReplyTo: '<reply>' },
      '[]'
    )
    assert.equal(getDemoDraft(fullDraft.id)?.bcc, 'bcc@example.com')

    const filterId = createDemoFilter({
      conditions: {
        match: 'any',
        conditions: [{ field: 'subject', operator: 'contains', value: ' urgent ' }]
      },
      action: 'star',
      enabled: false,
      sort_order: 9
    })
    updateDemoFilter(filterId, {
      field: 'from',
      operator: 'equals',
      value: 'a@example.com',
      target: 1,
      enabled: true,
      sort_order: 0
    })
    updateDemoFilter(filterId, {
      field: 'cc',
      operator: 'contains',
      value: 'team@example.com',
      action: 'label',
      target: 'Inbox',
      enabled: true,
      sort_order: 3
    })
    updateDemoFilter(filterId, {
      conditions: { match: 'all', conditions: [{ field: 'to', operator: 'contains', value: 'x' }] },
      action: 'move',
      target: null,
      enabled: false,
      sort_order: 2
    })
    updateDemoFilter(999, { field: 'ignored' })
    assert.equal(listDemoFilters().find((filter) => filter.id === filterId)?.enabled, false)
    createDemoFilters([
      {
        field: 'to',
        operator: 'contains',
        value: 'b',
        action: 'move',
        target: 'Archive',
        enabled: true,
        sortOrder: 4
      }
    ])
    reorderDemoFilters([502, filterId, 999])
    assert.equal(listDemoFilters().find((filter) => filter.id === 502)?.sortOrder, 0)
    assert.equal(listDemoFilters().find((filter) => filter.id === filterId)?.sortOrder, 1)
    deleteDemoFilter(filterId)
    assert.equal(
      listDemoFilters().some((filter) => filter.id === filterId),
      false
    )

    const templateId = createDemoMessageTemplate({
      name: 'A template',
      subject: 1,
      html: null,
      isSnippet: true
    })
    updateDemoMessageTemplate(templateId, {
      name: 'Renamed',
      subject: 'Subject',
      html: '<p>Body</p>',
      isSnippet: false
    })
    updateDemoMessageTemplate(999, {})
    updateDemoMessageTemplate(templateId, { name: 1, subject: 1, html: 1, isSnippet: 1 })
    assert.deepEqual(
      listDemoMessageTemplates().find((template) => template.id === templateId)?.isSnippet,
      false
    )
    deleteDemoMessageTemplate(templateId)
    assert.equal(
      listDemoMessageTemplates().some((template) => template.id === templateId),
      false
    )

    assert.equal(createDemoSenderRule({ sender: ' Name <PERSON@example.com> ' }), 601)
    assert.equal(createDemoSenderRule({ sender: 'person@example.com' }), 601)
    assert.equal(createDemoSenderRule({ type: 'allow', sender: '  ' }), null)
    assert.equal(listDemoSenderRules()[0].normalizedSender, 'person@example.com')
    deleteDemoSenderRule(601)
    assert.equal(listDemoSenderRules().length, 0)

    assert.equal(createDemoSenderRule({ type: 'allow', sender: 'no-name@example.com' }), 602)
    assert.equal(listDemoSenderRules()[0].type, 'allow')
    assert.equal(createDemoSenderRule({ sender: 'second@example.com' }), 603)
    assert.equal(listDemoSenderRules().length, 2)
  })
})

describe('demo mode shares, attachments, and sending', () => {
  it('shares only authorized messages and attachments and tracks first reads', () => {
    const token = createDemoShareToken(103)
    assert.ok(token)
    assert.equal(createDemoShareToken(103), token)
    assert.equal(getDemoMessageByShareToken(token ?? '')?.id, 103)
    markDemoShareTokenAsRead(token ?? '')
    markDemoShareTokenAsRead(token ?? '')
    assert.equal(countDemoSharedMessageReads('<demo-3@mail.local>'), 1)
    assert.equal(getDemoSharedAttachment(token ?? '', 201)?.filename, 'rollout-brief.txt')
    assert.equal(getDemoSharedAttachment(token ?? '', 202), null)
    assert.equal(getDemoSharedAttachment('missing', 201), null)
    assert.equal(createDemoShareToken(999), null)

    const threadToken = createDemoThreadShareToken(['<demo-2@mail.local>', '<demo-3@mail.local>'])
    assert.ok(threadToken)
    assert.equal(
      createDemoThreadShareToken(['<demo-2@mail.local>', '<demo-3@mail.local>']),
      threadToken
    )
    assert.equal(getDemoSharedMessagesByShareToken(threadToken ?? '').length, 2)
    assert.equal(createDemoThreadShareToken([]), null)
    assert.equal(getDemoSharedMessagesByShareToken('missing').length, 0)
    assert.equal(listDemoAttachmentsForMessage('<demo-3@mail.local>')[0].id, 201)
    assert.equal(
      listDemoAttachmentsForMessages(['<demo-3@mail.local>', '<demo-4@mail.local>']).length,
      2
    )
    assert.equal(getDemoAttachment(999), null)
  })

  it('stores public attachments and sends messages with attachments and recipient contacts', async () => {
    storeDemoPublicAttachments(
      [{ name: 'file.txt', contentType: 'text/plain', contentBase64: 'aGVsbG8=', size: 5 }],
      [{ token: 'stored-token' }]
    )
    assert.equal(getDemoPublicAttachment('stored-token')?.content?.toString(), 'hello')
    registerDemoPublicAttachment('registered-token', {
      filename: 'empty.txt',
      contentType: 'text/plain',
      size: 0
    })
    assert.deepEqual(
      commitDemoPublicAttachments(['stored-token', 'registered-token', 'missing-token']),
      ['stored-token', 'registered-token']
    )
    assert.deepEqual(commitDemoPublicAttachments(['stored-token']), [])
    assert.deepEqual(deleteDemoPublicAttachments(['stored-token', 'missing-token']), [])
    uncommitDemoPublicAttachments(['stored-token', 'missing-token'])
    assert.deepEqual(deleteDemoPublicAttachments(['stored-token']), ['stored-token'])

    const sent = await sendDemoMessage({
      to: 'Recipient <recipient@example.com>',
      cc: 'Copy <copy@example.com>',
      bcc: 'Blind <blind@example.com>',
      subject: 'Sent subject',
      html: '<p>Hello <strong>world</strong></p>',
      fromName: 'Custom Sender',
      attachments: [
        { name: 'note.txt', contentType: 'text/plain', contentBase64: 'bm90ZQ==', size: 4 }
      ]
    })
    assert.equal(sent.mailbox, 'Sent')
    assert.equal(sent.textContent, 'Hello world')
    assert.match(sent.from, /^Custom Sender </)
    assert.equal(listDemoAttachmentsForMessage(sent.messageId)[0].filename, 'note.txt')
    assert.equal(findDemoContactByEmail('blind@example.com')?.useCount, 1)

    const fallback = await sendDemoMessage({
      to: '',
      subject: 'Fallback subject',
      attachments: []
    })
    assert.equal(fallback.textContent, 'Fallback subject')
    assert.equal(fallback.htmlContent, null)
  })

  it('handles non-Korean AI output and configuration values that do not update settings', () => {
    assert.match(
      generateDemoAiCompose({
        mode: 'new',
        subject: 'Hi',
        html: '',
        to: 'Pat <p@example.com>',
        rewriteMode: 'concise'
      }),
      /shorter version/
    )
    assert.match(
      generateDemoAiCompose({
        mode: 'new',
        subject: 'Hi',
        html: '',
        to: '',
        rewriteMode: 'friendly'
      }),
      /friendlier version/
    )
    assert.match(
      generateDemoAiReplyDraft(
        [{ from: null, preview: 'Previous', subject: null }],
        { from: null, preview: null, subject: null },
        false
      ),
      /Hi there/
    )
    assert.match(
      generateDemoThreadSummary('Inbox', 'thread-demo-launch', 'English') ?? '',
      /^Summary:/
    )
    assert.deepEqual(generateDemoTranslations([' Hello '], 'French'), ['[Demo French] Hello'])

    saveDemoSettings({
      signatureProfiles: [{ id: -1, name: '', html: 1, isDefault: false }, null],
      imap: { host: ' ', port: 0, user: ' ', password: ' ', mailbox: ' ', pollSeconds: 0 },
      smtp: { host: ' ', port: 0, user: ' ', password: ' ', from: ' ', undoSendSeconds: -1 },
      openai: { apiKey: ' ', model: ' ' },
      oidc: {
        authorizationUrl: ' ',
        tokenUrl: ' ',
        userInfoUrl: ' ',
        clientId: ' ',
        clientSecret: ' '
      },
      github: { clientId: ' ', clientSecret: ' ' },
      discord: null,
      quietHours: { start: '08:00', end: '18:00', timezone: 'UTC' }
    })
    assert.equal(getDemoSignatureProfiles()[0].name, 'Signature 1')
    assert.equal(getDemoSmtpConfig().undoSendSeconds, 0)
  })

  it('orders equal-time thread messages by the requested mailbox and uid', async () => {
    const receivedAt = getDemoStoredMessageById(101)?.receivedAt
    assert.ok(receivedAt)
    vi.useFakeTimers()
    vi.setSystemTime(receivedAt as Date)
    await sendDemoMessage({
      to: 'recipient@example.com',
      subject: 'Same-time reply',
      inReplyTo: 'thread-demo-welcome',
      attachments: []
    })
    await sendDemoMessage({
      to: 'recipient@example.com',
      subject: 'Same-time follow-up',
      inReplyTo: 'thread-demo-welcome',
      attachments: []
    })
    const sameTimeSent = listDemoStoredMessages('Sent').filter((message) =>
      message.subject.startsWith('Same-time')
    )
    assert.deepEqual(
      sameTimeSent.map((message) => message.subject),
      ['Same-time follow-up', 'Same-time reply']
    )
    assert.equal(getDemoMessagesInThread('thread-demo-welcome', 'Inbox').at(-1)?.mailbox, 'Sent')
    assert.equal(getDemoMessagesInThread('thread-demo-welcome', 'Sent').at(-1)?.mailbox, 'Inbox')
    vi.useRealTimers()
  })

  it('preserves defaults for invalid settings and handles optional message data', () => {
    saveDemoSettings({
      signatureProfiles: [],
      imap: null,
      smtp: null,
      openai: null,
      oidc: null,
      github: null,
      quietHours: null
    })
    assert.deepEqual(getDemoSignatureProfiles(), [])

    const sent = sendDemoMessage({ to: '', subject: '', html: '', attachments: [] })
    return sent.then((message) => {
      assert.equal(message.textContent, '')
      assert.equal(message.htmlContent, '')
      assert.equal(listDemoMessagesForContact('missing@example.com').length, 0)
      assert.equal(listDemoContactGroups('missing').length, 0)
      assert.equal(getDemoMessagesInThread('thread-demo-launch', 'Archive').length, 2)
    })
  })

  it('ignores incorrectly typed individual settings without changing valid defaults', () => {
    const before = getDemoDisplayConfig()
    saveDemoSettings({
      imap: { host: 1, port: '993', secure: 'true', allowInvalidCertificate: 1 },
      smtp: { host: 1, port: '587', secure: 'false', from: 1, undoSendSeconds: '30' },
      openai: { apiKey: 1, model: 1, importanceClassification: 'false' },
      oidc: { clientId: 1, clientSecret: 1 },
      github: { clientId: 1, clientSecret: 1 },
      discord: { clientId: 1, clientSecret: 1 },
      quietHours: { enabled: 'true', start: 1, end: 1, timezone: 1 }
    })

    const after = getDemoDisplayConfig()
    assert.deepEqual(after.imap, before.imap)
    assert.deepEqual(after.smtp, before.smtp)
    assert.deepEqual(after.openai, before.openai)
    assert.deepEqual(after.oidc, before.oidc)
    assert.deepEqual(after.github, before.github)
    assert.deepEqual(after.discord, before.discord)
    assert.deepEqual(after.quietHours, before.quietHours)
  })

  it('uses defaults for optional demo inputs and supports every mailbox move target', () => {
    assert.equal(moveDemoMessage({ id: 101, mailbox: 'Inbox' }, 'trash'), 'Trash')
    assert.equal(moveDemoMessage({ id: 101, mailbox: 'Trash' }, 'inbox'), 'Inbox')

    const draft = saveDemoDraft({}, '[]')
    assert.deepEqual(getDemoDraft(draft.id), {
      ...getDemoDraft(draft.id),
      toAddr: '',
      cc: '',
      bcc: '',
      subject: '',
      html: '',
      inReplyTo: null
    })

    const filterId = createDemoFilter({})
    assert.equal(
      listDemoFilters().some((filter) => filter.id === filterId),
      true
    )
    assert.equal(createDemoMessageTemplate({}), 603)
    assert.equal(createDemoSenderRule({}), null)
    assert.equal(getDemoPublicAttachment('missing-token'), null)

    saveDemoContactGroup({ name: 'Operations', description: 'Escalations', contactIds: [] })
    assert.equal(listDemoContactGroups('escalation').length, 1)

    assert.match(
      generateDemoAiCompose({ mode: 'new', subject: '', html: '', to: '<recipient@example.com>' }),
      /Hello there/
    )
    assert.doesNotMatch(
      generateDemoAiCompose({ mode: 'new', subject: '', html: '', to: '' }),
      /shorter version|more formal version|friendlier version/
    )
    assert.match(
      generateDemoAiReplyDraft([], { from: null, preview: null, subject: null }, false),
      /thanks for the context/
    )
  })
})
