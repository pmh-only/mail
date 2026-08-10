import type { HeadConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const base = process.env.DOCS_BASE || '/'
const favicon: HeadConfig = [
  'link',
  { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }
]

export default withMermaid({
  base,
  lang: 'en-US',
  title: 'mail',
  description: 'Documentation for the self-hosted, single-user webmail client.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0d0d10' }],
    ...(process.env.NODE_ENV === 'production' ? [favicon] : [])
  ],
  mermaid: {
    securityLevel: 'strict'
  },
  vite: {
    plugins: [
      {
        name: 'vitepress-dev-favicon',
        apply: 'serve',
        transformIndexHtml: {
          order: 'pre',
          handler: () => [
            {
              tag: favicon[0],
              attrs: favicon[1],
              injectTo: 'head'
            }
          ]
        }
      }
    ],
    optimizeDeps: {
      needsInterop: ['dayjs']
    }
  },
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/' },
      { text: 'Configuration', link: '/reference/configuration' },
      { text: 'API', link: '/reference/api' },
      { text: 'Live demo', link: 'https://maildemo.pmh.codes/' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Feature overview', link: '/features/' }
        ]
      },
      {
        text: 'Mail',
        items: [
          { text: 'Mail accounts', link: '/guide/mail-accounts' },
          { text: 'Reading and organizing', link: '/features/reading-and-organizing' },
          { text: 'Mailboxes', link: '/features/mailboxes' },
          { text: 'Composing and sending', link: '/features/composing-and-sending' },
          { text: 'Search', link: '/features/search' },
          { text: 'Contacts and groups', link: '/features/contacts' },
          { text: 'Signatures', link: '/features/signatures' },
          { text: 'Message templates', link: '/features/templates' }
        ]
      },
      {
        text: 'Security and sharing',
        items: [
          { text: 'Authentication', link: '/guide/authentication' },
          { text: 'Privacy controls', link: '/features/privacy' },
          { text: 'Mail authentication', link: '/features/mail-authentication' },
          { text: 'OpenPGP', link: '/features/openpgp' },
          { text: 'Public sharing', link: '/features/public-sharing' },
          { text: 'Read tracking', link: '/features/read-tracking' }
        ]
      },
      {
        text: 'Automation',
        items: [
          { text: 'AI features', link: '/features/ai' },
          { text: 'Filters', link: '/features/filters' },
          { text: 'Sender rules', link: '/features/sender-rules' },
          { text: 'Auto-cleanup', link: '/features/auto-cleanup' },
          { text: 'Push notifications', link: '/features/notifications' }
        ]
      },
      {
        text: 'App experience',
        items: [
          { text: 'Interface', link: '/features/interface' },
          { text: 'PWA and offline', link: '/features/pwa-and-offline' }
        ]
      },
      {
        text: 'Operations',
        items: [
          { text: 'Deployment', link: '/operations/deployment' },
          { text: 'Operations dashboard', link: '/features/operations' },
          { text: 'Audit log', link: '/features/audit-log' },
          { text: 'Settings backup', link: '/features/settings-backup' },
          { text: 'Public IMAP proxy', link: '/features/imap-proxy' },
          { text: 'Demo mode', link: '/features/demo-mode' }
        ]
      },
      {
        text: 'Integrations',
        items: [{ text: 'External API and MCP', link: '/reference/api' }]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Architecture', link: '/reference/architecture' }
        ]
      },
      {
        text: 'Contributing',
        items: [{ text: 'Development', link: '/development' }]
      }
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/pmh-only/mail' }],
    editLink: {
      pattern: 'https://github.com/pmh-only/mail/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    outline: [2, 3],
    docFooter: {
      prev: 'Previous page',
      next: 'Next page'
    }
  }
})
