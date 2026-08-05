import assert from 'node:assert/strict'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  demo: false,
  row: null as Record<string, unknown> | null,
  signatures: [] as Array<Record<string, unknown>>,
  selectCount: 0,
  updates: [] as Array<Record<string, unknown>>,
  encryptionConfigured: false,
  demoDisplay: {
    signature: 'demo signature',
    smtp: { undoSendSeconds: 0 },
    quietHours: { enabled: true, start: '10:00', end: '11:00', timezone: 'UTC' }
  },
  secretStorage: { configured: false, text: 'not configured' },
  mailConfig: { name: 'mailConfig' },
  mailSignature: { name: 'mailSignature' }
}))

vi.mock('$env/dynamic/private', () => ({ env: state.env }))
vi.mock('./db/schema', () => ({ mailConfig: state.mailConfig, mailSignature: state.mailSignature }))
vi.mock('drizzle-orm', () => ({ asc: vi.fn(), desc: vi.fn(), eq: vi.fn() }))
vi.mock('./db', () => ({
  db: {
    select() {
      state.selectCount += 1
      return {
        from(table: object) {
          if (table === state.mailConfig) {
            return {
              where() {
                return { limit: async () => (state.row ? [state.row] : []) }
              }
            }
          }

          const profiles = [...state.signatures] as Array<Record<string, unknown>> & {
            limit?: (count: number) => Promise<Array<Record<string, unknown>>>
          }
          profiles.limit = async (count) => profiles.slice(0, count)
          return { orderBy: () => profiles }
        }
      }
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          state.updates.push(values)
          return { where: async () => undefined }
        }
      }
    }
  }
}))
vi.mock('./demo', () => ({
  isDemoModeEnabled: () => state.demo,
  getDemoDisplayConfig: () => state.demoDisplay,
  getDemoImapConfig: () => ({ id: 'demo-imap', host: 'demo', password: 'demo' }),
  getDemoSmtpConfig: () => ({ id: 'demo-smtp', host: 'demo', password: 'demo' }),
  getDemoOidcConfig: () => ({
    issuer: 'demo-issuer',
    authorizationUrl: 'demo-auth',
    tokenUrl: 'demo-token',
    userInfoUrl: 'demo-user-info',
    legacyDiscoveryUrl: '',
    clientId: 'demo-id',
    clientSecret: 'demo-secret'
  }),
  getDemoSignatureProfiles: () => [{ id: 1, html: 'demo profile' }]
}))
vi.mock('./secrets', () => ({
  decryptSecret: (value: string) => value.replace(/^encrypted:/, ''),
  encryptSecret: (value: string) => `encrypted:${value}`,
  isEncryptedSecret: (value: string) => value.startsWith('encrypted:'),
  isSecretEncryptionConfigured: () => state.encryptionConfigured,
  getSecretStorageStatus: () => state.secretStorage
}))

import {
  DEFAULT_OPENAI_MODEL,
  getAuthenticationConfig,
  getDisplayConfig,
  getImapConfig,
  getImapConfigs,
  getOidcConfig,
  getOpenAIConfig,
  getQuietHoursConfig,
  getSignature,
  getSignatureProfiles,
  getSmtpConfig,
  getSmtpConfigs,
  getUndoSendSeconds,
  invalidateConfigCache,
  isAuthenticationConfigured,
  isOAuthClientConfigured,
  isOidcConfigured,
  isOidcConfigComplete,
  normalizeImapServers,
  normalizeSmtpServers
} from './config'

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.demo = false
  state.row = null
  state.signatures = []
  state.selectCount = 0
  state.updates = []
  state.encryptionConfigured = false
  state.secretStorage = { configured: false, text: 'not configured' }
  invalidateConfigCache()
})

describe('mail server configuration', () => {
  it('builds legacy IMAP and SMTP settings from environment defaults', async () => {
    state.env.IMAP_HOST = 'imap.example.test'
    state.env.IMAP_USER = 'ada@example.test'
    state.env.IMAP_PASSWORD = 'secret'
    state.env.IMAP_PORT = '143'
    state.env.IMAP_SECURE = 'false'
    state.env.SMTP_HOST = 'smtp.example.test'
    state.env.SMTP_USER = 'ada@example.test'
    state.env.SMTP_PASSWORD = 'secret'
    state.env.SMTP_PORT = '2525'
    state.env.SMTP_SECURE = 'true'

    assert.deepEqual(await getImapConfig(), {
      id: 'primary',
      name: 'Primary',
      host: 'imap.example.test',
      port: 143,
      secure: false,
      allowInvalidCertificate: false,
      user: 'ada@example.test',
      password: 'secret',
      mailbox: 'INBOX',
      pollSeconds: 15
    })
    assert.deepEqual(await getSmtpConfig(), {
      id: 'primary',
      name: 'Primary',
      host: 'smtp.example.test',
      port: 2525,
      secure: true,
      allowInvalidCertificate: false,
      user: 'ada@example.test',
      password: 'secret',
      from: 'ada@example.test'
    })
  })

  it('uses explicit database ports and certificate settings over environment defaults', async () => {
    state.row = {
      imapHost: 'imap',
      imapUser: 'user',
      imapPassword: 'password',
      imapPort: 143,
      imapSecure: false,
      imapAllowInvalidCertificate: true,
      smtpHost: 'smtp',
      smtpUser: 'user',
      smtpPassword: 'password',
      smtpPort: 465,
      smtpSecure: true,
      smtpAllowInvalidCertificate: true
    }

    expect(await getImapConfig()).toMatchObject({
      port: 143,
      secure: false,
      allowInvalidCertificate: true
    })
    expect(await getSmtpConfig()).toMatchObject({
      port: 465,
      secure: true,
      allowInvalidCertificate: true
    })
  })

  it('normalizes valid database and environment server arrays and ignores invalid entries', () => {
    state.row = {
      imapServers: JSON.stringify([
        { host: ' db-imap ', user: ' db-user ', password: 'encrypted:db-password' },
        {
          id: 'archive',
          name: ' Archive ',
          host: 'archive',
          port: 143.9,
          secure: false,
          allowInvalidCertificate: true,
          user: 'archive-user',
          password: 'archive-password',
          mailbox: ' Archive ',
          pollSeconds: 30.8
        },
        { host: 'missing-password', user: 'user' },
        null
      ]),
      smtpServers: [
        { host: 'db-smtp', user: 'db-user', password: 'db-password' },
        { host: '', user: 'ignored', password: 'ignored' }
      ]
    }
    state.env.IMAP_SERVERS =
      '[{"host":"env-imap","user":"env-user","password":"env-password","port":0}]'
    state.env.SMTP_SERVERS = 'not json'

    assert.deepEqual(normalizeImapServers(state.row as never), [
      {
        id: 'server-2',
        name: 'server-2',
        host: 'db-imap',
        port: 993,
        secure: true,
        allowInvalidCertificate: false,
        user: 'db-user',
        password: 'db-password',
        mailbox: 'INBOX',
        pollSeconds: 15
      },
      {
        id: 'archive',
        name: 'Archive',
        host: 'archive',
        port: 143,
        secure: false,
        allowInvalidCertificate: true,
        user: 'archive-user',
        password: 'archive-password',
        mailbox: 'Archive',
        pollSeconds: 30
      },
      {
        id: 'server-5',
        name: 'server-5',
        host: 'env-imap',
        port: 993,
        secure: true,
        allowInvalidCertificate: false,
        user: 'env-user',
        password: 'env-password',
        mailbox: 'INBOX',
        pollSeconds: 15
      }
    ])
    assert.deepEqual(normalizeSmtpServers(state.row as never), [
      {
        id: 'server-2',
        name: 'server-2',
        host: 'db-smtp',
        port: 587,
        secure: false,
        allowInvalidCertificate: false,
        user: 'db-user',
        password: 'db-password',
        from: 'db-user'
      }
    ])
  })

  it('keeps the primary name for explicitly identified server arrays', () => {
    state.row = {
      imapServers: [{ id: 'primary', host: 'imap', user: 'user', password: 'password' }],
      smtpServers: [{ id: 'primary', host: 'smtp', user: 'user', password: 'password' }]
    }

    assert.equal(normalizeImapServers(state.row as never)[0]?.name, 'Primary')
    assert.equal(normalizeSmtpServers(state.row as never)[0]?.name, 'Primary')
  })

  it('uses legacy database values before environment values and reports missing credentials', async () => {
    state.env.IMAP_HOST = 'env-imap'
    state.env.IMAP_USER = 'env-user'
    state.env.IMAP_PASSWORD = 'env-password'
    state.env.IMAP_PORT = 'invalid'
    state.env.IMAP_SECURE = 'FALSE'
    state.env.SMTP_HOST = 'env-smtp'
    state.env.SMTP_USER = 'env-user'
    state.env.SMTP_PASSWORD = 'env-password'
    state.env.SMTP_PORT = '2525'
    state.env.SMTP_SECURE = 'true'
    state.row = {
      imapHost: 'db-imap',
      imapUser: 'db-user',
      imapPassword: 'encrypted:db-password',
      imapMailbox: '',
      smtpHost: 'db-smtp',
      smtpUser: 'db-user',
      smtpPassword: 'encrypted:db-password',
      smtpFrom: ''
    }

    expect(await getImapConfig()).toMatchObject({
      host: 'db-imap',
      user: 'db-user',
      password: 'db-password',
      port: 993,
      secure: false,
      mailbox: 'INBOX'
    })
    expect(await getImapConfigs()).toHaveLength(1)
    expect(await getSmtpConfig()).toMatchObject({
      host: 'db-smtp',
      user: 'db-user',
      password: 'db-password',
      port: 2525,
      secure: true,
      from: 'db-user'
    })
    expect(await getSmtpConfigs()).toHaveLength(1)

    state.row = null
    for (const key of [
      'IMAP_HOST',
      'IMAP_USER',
      'IMAP_PASSWORD',
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASSWORD'
    ])
      delete state.env[key]
    invalidateConfigCache()
    assert.deepEqual(await getImapConfig(), {
      missing: ['IMAP Host', 'IMAP User', 'IMAP Password']
    })
    assert.deepEqual(await getSmtpConfig(), {
      missing: ['SMTP Host', 'SMTP User', 'SMTP Password']
    })
  })

  it('reports only absent SMTP credentials', async () => {
    state.env.SMTP_HOST = 'smtp.example.test'
    state.env.SMTP_USER = 'ada@example.test'

    assert.deepEqual(await getSmtpConfig(), {
      missing: ['SMTP Password']
    })
  })

  it('reports each missing IMAP and SMTP credential independently', async () => {
    state.env.IMAP_USER = 'user'
    state.env.IMAP_PASSWORD = 'password'
    state.env.SMTP_USER = 'user'
    state.env.SMTP_PASSWORD = 'password'

    assert.deepEqual(await getImapConfig(), { missing: ['IMAP Host'] })
    assert.deepEqual(await getSmtpConfig(), { missing: ['SMTP Host'] })

    state.env.IMAP_HOST = 'imap.example.test'
    state.env.SMTP_HOST = 'smtp.example.test'
    delete state.env.IMAP_USER
    delete state.env.SMTP_USER
    assert.deepEqual(await getImapConfig(), { missing: ['IMAP User'] })
    assert.deepEqual(await getSmtpConfig(), { missing: ['SMTP User'] })

    state.env.IMAP_USER = 'user'
    state.env.SMTP_USER = 'user'
    delete state.env.IMAP_PASSWORD
    delete state.env.SMTP_PASSWORD
    assert.deepEqual(await getImapConfig(), { missing: ['IMAP Password'] })
    assert.deepEqual(await getSmtpConfig(), { missing: ['SMTP Password'] })
  })

  it('caches rows, invalidates them, and encrypts plaintext secrets during loading', async () => {
    state.encryptionConfigured = true
    state.row = {
      imapHost: 'imap',
      imapUser: 'user',
      imapPassword: 'plain',
      smtpPassword: 'plain-smtp',
      githubClientSecret: 'github',
      discordClientSecret: 'discord',
      oidcClientSecret: 'oidc',
      openaiApiKey: 'key'
    }

    await getImapConfig()
    await getImapConfig()
    assert.equal(state.selectCount, 1)
    assert.deepEqual(state.updates, [
      {
        imapPassword: 'encrypted:plain',
        smtpPassword: 'encrypted:plain-smtp',
        githubClientSecret: 'encrypted:github',
        discordClientSecret: 'encrypted:discord',
        oidcClientSecret: 'encrypted:oidc',
        openaiApiKey: 'encrypted:key'
      }
    ])

    invalidateConfigCache()
    await getImapConfig()
    assert.equal(state.selectCount, 2)
  })

  it('leaves already encrypted secrets unchanged and reads stored fallback passwords', async () => {
    state.encryptionConfigured = true
    state.row = {
      imapPassword: 'encrypted:imap-password',
      smtpPassword: 'encrypted:smtp-password',
      githubClientSecret: 'encrypted:github-secret',
      discordClientSecret: 'encrypted:discord-secret',
      oidcClientSecret: 'encrypted:oidc-secret',
      openaiApiKey: 'encrypted:openai-key'
    }

    assert.deepEqual(await getImapConfig(), { missing: ['IMAP Host', 'IMAP User'] })
    assert.deepEqual(await getSmtpConfig(), { missing: ['SMTP Host', 'SMTP User'] })
    assert.deepEqual(state.updates, [])
  })

  it('uses demo mode while loading the row for settings without a demo shortcut', async () => {
    state.demo = true

    assert.deepEqual(await getOpenAIConfig(), {
      apiKey: '',
      model: DEFAULT_OPENAI_MODEL,
      importanceClassification: true
    })
  })

  it('returns demo settings without querying the database', async () => {
    state.demo = true

    assert.equal(((await getImapConfig()) as { id: string }).id, 'demo-imap')
    assert.equal(((await getSmtpConfig()) as { id: string }).id, 'demo-smtp')
    assert.deepEqual(await getImapConfigs(), [{ id: 'demo-imap', host: 'demo', password: 'demo' }])
    assert.deepEqual(await getSmtpConfigs(), [{ id: 'demo-smtp', host: 'demo', password: 'demo' }])
    assert.equal(await getUndoSendSeconds(), 0)
    assert.equal((await getOidcConfig()).issuer, 'demo-issuer')
    assert.deepEqual(await getAuthenticationConfig(), {
      github: { clientId: '', clientSecret: '' },
      discord: { clientId: '', clientSecret: '' },
      oidc: {
        issuer: 'demo-issuer',
        authorizationUrl: 'demo-auth',
        tokenUrl: 'demo-token',
        userInfoUrl: 'demo-user-info',
        legacyDiscoveryUrl: '',
        clientId: 'demo-id',
        clientSecret: 'demo-secret'
      }
    })
    assert.equal(await getSignature(), 'demo signature')
    assert.deepEqual(await getSignatureProfiles(), [{ id: 1, html: 'demo profile' }])
    assert.deepEqual(await getQuietHoursConfig(), state.demoDisplay.quietHours)
    assert.equal(await isOidcConfigured(), true)
    assert.equal(await isAuthenticationConfigured(), true)
    assert.deepEqual(await getDisplayConfig(), state.demoDisplay)
    assert.equal(state.selectCount, 0)
  })

  it('uses cached unencrypted rows and covers environment display fallbacks', async () => {
    state.row = {}
    await getImapConfig()
    await getImapConfig()
    assert.equal(state.selectCount, 1)

    state.env.IMAP_HOST = 'env-imap'
    state.env.IMAP_USER = 'env-user'
    state.env.IMAP_PASSWORD = 'env-password'
    state.env.SMTP_HOST = 'env-smtp'
    state.env.SMTP_USER = 'env-user'
    state.env.SMTP_PASSWORD = 'env-password'
    state.env.GITHUB_CLIENT_ID = 'github-id'
    state.env.GITHUB_CLIENT_SECRET = 'github-secret'
    state.env.DISCORD_CLIENT_ID = 'discord-id'
    state.env.DISCORD_CLIENT_SECRET = 'discord-secret'
    invalidateConfigCache()

    const display = await getDisplayConfig()
    assert.equal(display.imap.source, 'env')
    assert.equal(display.smtp.source, 'env')
    assert.equal(display.github.source, 'env')
    assert.equal(display.discord.source, 'env')
  })

  it('falls back to the legacy signature and reports an incomplete OIDC configuration', async () => {
    state.row = { signature: 'legacy signature', oidcClientId: 'id' }

    assert.equal(await getSignature(), 'legacy signature')
    assert.equal(await isOidcConfigured(), false)
  })

  it('loads authentication, OpenAI, display, quiet-hours, and signature settings from their effective sources', async () => {
    state.env.OPENAI_API_KEY = ' env-key '
    state.env.OPENAI_MODEL = ' env-model '
    state.env.OPENAI_IMPORTANCE_CLASSIFICATION = 'false'
    state.env.SMTP_UNDO_SEND_SECONDS = '99.8'
    state.row = {
      githubClientId: 'github-id',
      githubClientSecret: 'encrypted:github-secret',
      discordClientId: '',
      oidcIssuer: 'issuer',
      oidcAuthorizationUrl: 'auth',
      oidcTokenUrl: 'token',
      oidcUserInfoUrl: 'userinfo',
      oidcClientId: 'oidc-id',
      oidcClientSecret: 'encrypted:oidc-secret',
      openaiApiKey: 'encrypted:row-key',
      openaiModel: ' row-model ',
      openaiImportanceClassification: false,
      smtpUndoSendSeconds: -5,
      signature: 'legacy signature',
      quietHoursEnabled: true,
      quietHoursStart: '22:15',
      quietHoursEnd: 'not-a-time',
      quietHoursTimezone: 'invalid/timezone'
    }
    state.signatures = [{ id: 2, html: '<p>Default profile</p>' }]

    expect(await getAuthenticationConfig()).toMatchObject({
      github: { clientId: 'github-id', clientSecret: 'github-secret' },
      discord: { clientId: '', clientSecret: '' },
      oidc: { issuer: 'issuer', clientSecret: 'oidc-secret' }
    })
    assert.deepEqual(await getOpenAIConfig(), {
      apiKey: 'row-key',
      model: 'row-model',
      importanceClassification: false
    })
    assert.equal(await getUndoSendSeconds(), 0)
    assert.equal(await getSignature(), '<p>Default profile</p>')
    assert.deepEqual(await getQuietHoursConfig(), {
      enabled: true,
      start: '22:15',
      end: '07:00',
      timezone: 'UTC'
    })

    const display = await getDisplayConfig()
    assert.equal(display.openai.apiKey, '••••••••')
    assert.equal(display.openai.source, 'db')
    assert.equal(display.smtp.undoSendSeconds, 0)
    assert.equal(display.secretStorage.text, 'not configured')
  })

  it('uses environment OpenAI defaults and clamps undo-send values', async () => {
    state.env.OPENAI_API_KEY = '  env-key  '
    state.env.SMTP_UNDO_SEND_SECONDS = '12.9'

    assert.deepEqual(await getOpenAIConfig(), {
      apiKey: 'env-key',
      model: DEFAULT_OPENAI_MODEL,
      importanceClassification: true
    })
    assert.equal(await getUndoSendSeconds(), 12)
    state.env.SMTP_UNDO_SEND_SECONDS = 'not-a-number'
    invalidateConfigCache()
    assert.equal(await getUndoSendSeconds(), 0)
  })

  it('masks display credentials and identifies database and environment sources', async () => {
    state.env.IMAP_HOST = 'env-imap'
    state.env.IMAP_PASSWORD = 'env-password'
    state.env.SMTP_HOST = 'env-smtp'
    state.env.SMTP_PASSWORD = 'env-password'
    state.env.OIDC_CLIENT_SECRET = 'env-secret'
    state.row = {
      imapServers: [{ host: 'db-imap', user: 'db-user', password: 'db-password' }],
      smtpServers: [{ host: 'db-smtp', user: 'db-user', password: 'db-password' }],
      githubClientId: 'github-id',
      githubClientSecret: 'github-secret'
    }

    const display = await getDisplayConfig()
    assert.equal(display.imap.password, '••••••••')
    assert.equal(display.imap.source, 'db')
    assert.equal(display.smtp.password, '••••••••')
    assert.equal(display.smtp.source, 'db')
    assert.equal(display.oidc.clientSecret, '••••••••')
    assert.equal(display.oidc.source, 'env')
    assert.equal(display.github.clientSecret, '••••••••')
    assert.equal(display.github.source, 'db')
  })

  it('evaluates OAuth and OIDC completeness and authentication setup state', async () => {
    assert.equal(isOAuthClientConfigured({ clientId: 'id', clientSecret: 'secret' }), true)
    assert.equal(isOAuthClientConfigured({ clientId: 'id', clientSecret: '' }), false)
    assert.equal(
      isOidcConfigComplete({
        clientId: 'id',
        clientSecret: 'secret',
        issuer: '',
        authorizationUrl: '',
        tokenUrl: '',
        userInfoUrl: '',
        legacyDiscoveryUrl: 'discovery'
      }),
      true
    )
    assert.equal(
      isOidcConfigComplete({
        clientId: 'id',
        clientSecret: 'secret',
        issuer: 'issuer',
        authorizationUrl: '',
        tokenUrl: 'token',
        userInfoUrl: 'userinfo',
        legacyDiscoveryUrl: ''
      }),
      false
    )

    state.row = { authSetupComplete: true }
    assert.equal(await isAuthenticationConfigured(), true)
    state.row = { githubClientId: 'id', githubClientSecret: 'secret' }
    invalidateConfigCache()
    assert.equal(await isAuthenticationConfigured(), true)
  })

  it('uses empty display defaults and database values for every credential source', async () => {
    state.row = null
    const emptyDisplay = await getDisplayConfig()
    assert.equal(emptyDisplay.imap.password, '')
    assert.equal(emptyDisplay.smtp.password, '')
    assert.equal(emptyDisplay.oidc.clientSecret, '')
    assert.equal(emptyDisplay.github.clientSecret, '')
    assert.equal(emptyDisplay.discord.clientSecret, '')
    assert.equal(emptyDisplay.openai.apiKey, '')

    invalidateConfigCache()
    state.row = {
      imapHost: 'imap',
      imapUser: 'user',
      imapPassword: 'password',
      smtpHost: 'smtp',
      smtpUser: 'user',
      smtpPassword: 'password',
      oidcIssuer: 'issuer',
      oidcAuthorizationUrl: 'authorization',
      oidcTokenUrl: 'token',
      oidcUserInfoUrl: 'userinfo',
      oidcClientId: 'oidc-id',
      oidcClientSecret: 'oidc-secret',
      githubClientId: 'github-id',
      githubClientSecret: 'github-secret',
      discordClientId: 'discord-id',
      discordClientSecret: 'discord-secret',
      openaiApiKey: 'openai-key',
      openaiModel: 'model',
      openaiImportanceClassification: true,
      smtpUndoSendSeconds: 31
    }
    const display = await getDisplayConfig()
    assert.equal(display.imapServers[0].source, 'db')
    assert.equal(display.smtpServers[0].source, 'db')
    assert.equal(display.oidc.source, 'db')
    assert.equal(display.github.source, 'db')
    assert.equal(display.discord.source, 'db')
    assert.equal(display.openai.apiKeySource, 'db')
    assert.equal(display.smtp.undoSendSeconds, 30)
  })

  it('masks environment passwords in incomplete display settings', async () => {
    state.row = {}
    state.env.IMAP_PASSWORD = 'imap-password'
    state.env.SMTP_PASSWORD = 'smtp-password'

    const display = await getDisplayConfig()
    assert.equal(display.imap.password, '••••••••')
    assert.equal(display.smtp.password, '••••••••')
  })

  it('uses environment authentication fields and alternative authentication paths', async () => {
    state.env.OIDC_ISSUER = 'issuer'
    state.env.OIDC_AUTHORIZATION_URL = 'authorization'
    state.env.OIDC_TOKEN_URL = 'token'
    state.env.OIDC_USER_INFO_URL = 'userinfo'
    state.env.OIDC_CLIENT_ID = 'oidc-id'
    state.env.OIDC_CLIENT_SECRET = 'oidc-secret'
    state.env.DISCORD_CLIENT_ID = 'discord-id'
    state.env.DISCORD_CLIENT_SECRET = 'discord-secret'
    expect(await getAuthenticationConfig()).toMatchObject({
      discord: { clientId: 'discord-id', clientSecret: 'discord-secret' },
      oidc: { issuer: 'issuer', clientSecret: 'oidc-secret' }
    })
    assert.equal(await isAuthenticationConfigured(), true)

    invalidateConfigCache()
    state.row = { authUserId: 'owner' }
    assert.equal(await isAuthenticationConfigured(), true)
  })

  it('uses environment credentials when database fields are blank', async () => {
    state.row = {
      imapHost: '',
      imapUser: '',
      imapPassword: '',
      smtpHost: '',
      smtpUser: '',
      smtpPassword: ''
    }
    state.env.IMAP_HOST = 'imap.env.test'
    state.env.IMAP_USER = 'imap-user'
    state.env.IMAP_PASSWORD = 'imap-password'
    state.env.SMTP_HOST = 'smtp.env.test'
    state.env.SMTP_USER = 'smtp-user'
    state.env.SMTP_PASSWORD = 'smtp-password'

    expect(await getImapConfig()).toMatchObject({
      host: 'imap.env.test',
      user: 'imap-user',
      password: 'imap-password'
    })
    expect(await getSmtpConfig()).toMatchObject({
      host: 'smtp.env.test',
      user: 'smtp-user',
      password: 'smtp-password'
    })
  })

  it('uses executable configuration fallbacks for empty and OIDC-only settings', async () => {
    assert.equal(await getUndoSendSeconds(), 0)
    assert.equal(await getSignature(), '')

    state.row = {
      imapHost: 'imap',
      imapPassword: 'password',
      smtpHost: 'smtp',
      smtpPassword: 'password',
      discordClientId: 'discord-id',
      discordClientSecret: 'encrypted:discord-secret'
    }
    invalidateConfigCache()
    const display = await getDisplayConfig()
    assert.equal(display.imap.password, '••••••••')
    assert.equal(display.imap.source, 'db')
    assert.equal(display.smtp.password, '••••••••')
    assert.equal(display.smtp.source, 'db')
    assert.equal((await getAuthenticationConfig()).discord.clientSecret, 'discord-secret')

    state.row = {
      oidcIssuer: 'issuer',
      oidcAuthorizationUrl: 'authorization',
      oidcTokenUrl: 'token',
      oidcUserInfoUrl: 'userinfo',
      oidcClientId: 'oidc-id',
      oidcClientSecret: 'oidc-secret'
    }
    invalidateConfigCache()
    assert.equal(await isAuthenticationConfigured(), true)
  })
})
