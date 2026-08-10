// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import ApiDocsPage from './+page.svelte'

describe('API documentation page', () => {
  it('renders REST and MCP documentation using the current origin', () => {
    render(ApiDocsPage)
    expect(screen.getByRole('heading', { name: 'Mail API & MCP' })).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/api/external/v1`)).toBeInTheDocument()
    expect(screen.getByText(/new WebSocket/)).toHaveTextContent(
      `${window.location.origin.replace(/^http/, 'ws')}/api/external/v1/mcp/ws`
    )
    expect(screen.getByRole('link', { name: /Settings → API Keys/ })).toHaveAttribute(
      'href',
      '/settings/api'
    )
  })

  it('documents every public endpoint and MCP tool', () => {
    render(ApiDocsPage)
    for (const endpoint of [
      '/mailboxes',
      '/messages',
      '/messages/:id',
      '/send-jobs/:id',
      '/attachments/:id'
    ]) {
      expect(screen.getAllByText(endpoint).length).toBeGreaterThan(0)
    }
    for (const tool of ['list_messages', 'get_message', 'send_message']) {
      expect(screen.getByText(tool)).toBeInTheDocument()
    }
  })
})
