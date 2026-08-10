import { defineConfig } from 'vitepress'

const base = process.env.DOCS_BASE || '/'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'mail',
  description: 'Documentation for the self-hosted, single-user webmail client.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0d0d10' }],
    ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }]
  ],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/reference/configuration' },
      { text: 'API', link: '/reference/api' },
      { text: 'Live demo', link: 'https://maildemo.pmh.codes/' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Authentication', link: '/guide/authentication' },
          { text: 'Mail accounts', link: '/guide/mail-accounts' }
        ]
      },
      {
        text: 'Operations',
        items: [{ text: 'Deployment', link: '/operations/deployment' }]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Architecture', link: '/reference/architecture' },
          { text: 'External API and MCP', link: '/reference/api' }
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
