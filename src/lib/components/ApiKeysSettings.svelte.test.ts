// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invalidateAll, toast } = vi.hoisted(() => ({ invalidateAll: vi.fn(), toast: vi.fn() }))
vi.mock('$app/navigation', () => ({ invalidateAll }))
vi.mock('svelte-sonner', () => ({ toast }))

import ApiKeysSettings from './ApiKeysSettings.svelte'

const existingKey = {
  id: 'key/one',
  name: 'Automation',
  prefix: 'pmail_abc',
  lastUsedAt: null,
  createdAt: '2026-08-10T08:00:00.000Z'
}

function loadResponse(apiKeys = [existingKey]) {
  return Response.json({ apiKeys })
}

describe('ApiKeysSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(loadResponse()))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    invalidateAll.mockReset().mockResolvedValue(undefined)
    toast.mockReset()
  })

  it('shows loading and then loaded keys', async () => {
    let resolveLoad!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve
      })
    )
    render(ApiKeysSettings)
    expect(screen.getByText('Loading API keys…')).toBeInTheDocument()
    resolveLoad(loadResponse())
    expect(await screen.findByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('pmail_abc')).toBeInTheDocument()
    expect(screen.getByText(/Last used Never/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open API and MCP documentation/ })).toHaveAttribute(
      'href',
      '/api-docs'
    )
  })

  it('renders the empty state', async () => {
    vi.mocked(fetch).mockResolvedValue(loadResponse([]))
    render(ApiKeysSettings)
    expect(await screen.findByText('No API keys have been created.')).toBeInTheDocument()
  })

  it('renders HTTP and unknown loading errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Keys unavailable' }), { status: 500 })
    )
    const { unmount } = render(ApiKeysSettings)
    expect(await screen.findByText('Keys unavailable')).toBeInTheDocument()
    unmount()

    vi.mocked(fetch).mockRejectedValueOnce('unknown')
    render(ApiKeysSettings)
    expect(await screen.findByText('Failed to load API keys.')).toBeInTheDocument()
  })

  it('keeps creation disabled for an empty name', async () => {
    render(ApiKeysSettings)
    await screen.findByText('Automation')
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled()
    await fireEvent.input(screen.getByPlaceholderText('Automation server'), {
      target: { value: '   ' }
    })
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled()
  })

  it('creates, displays, and copies a trimmed API key', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    vi.mocked(fetch)
      .mockResolvedValueOnce(loadResponse([]))
      .mockResolvedValueOnce(
        Response.json({
          apiKey: {
            ...existingKey,
            id: 'new-key',
            name: 'Build agent',
            key: 'pmail_secret_value'
          }
        })
      )
    render(ApiKeysSettings)
    await screen.findByText('No API keys have been created.')
    await user.type(screen.getByPlaceholderText('Automation server'), '  Build agent  ')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText('pmail_secret_value')).toBeInTheDocument()
    expect(screen.getByText('Build agent')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Automation server')).toHaveValue('')
    expect(fetch).toHaveBeenLastCalledWith('/api/settings/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Build agent' })
    })
    expect(toast).toHaveBeenCalledWith('API key created')

    await user.click(screen.getByRole('button', { name: 'Copy API key' }))
    expect(writeText).toHaveBeenCalledWith('pmail_secret_value')
    expect(toast).toHaveBeenCalledWith('API key copied')
  })

  it('shows creating state while the request is pending', async () => {
    let resolveCreate!: (response: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(loadResponse([]))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
    render(ApiKeysSettings)
    await screen.findByText('No API keys have been created.')
    await fireEvent.input(screen.getByPlaceholderText('Automation server'), {
      target: { value: 'Agent' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
    resolveCreate(Response.json({ apiKey: { ...existingKey, key: 'secret' } }))
    expect(await screen.findByText('secret')).toBeInTheDocument()
  })

  it.each([
    [
      new Response(JSON.stringify({ error: 'Name already used' }), { status: 409 }),
      'Name already used'
    ],
    ['reject', 'Failed to create API key.']
  ])('renders create failures', async (result, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(loadResponse([]))
    if (result instanceof Response) vi.mocked(fetch).mockResolvedValueOnce(result)
    else vi.mocked(fetch).mockRejectedValueOnce('unknown')
    render(ApiKeysSettings)
    await screen.findByText('No API keys have been created.')
    await fireEvent.input(screen.getByPlaceholderText('Automation server'), {
      target: { value: 'Agent' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('revokes a key and refreshes app data', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(loadResponse()).mockResolvedValueOnce(new Response(null))
    render(ApiKeysSettings)
    await user.click(await screen.findByRole('button', { name: 'Revoke Automation' }))
    await waitFor(() => expect(screen.queryByText('Automation')).not.toBeInTheDocument())
    expect(fetch).toHaveBeenLastCalledWith('/api/settings/api-keys/key%2Fone', {
      method: 'DELETE'
    })
    expect(toast).toHaveBeenCalledWith('API key revoked')
    expect(invalidateAll).toHaveBeenCalledOnce()
  })

  it('clears the one-time secret when its key is revoked', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(loadResponse([]))
      .mockResolvedValueOnce(
        Response.json({ apiKey: { ...existingKey, id: 'new-key', name: 'New', key: 'secret' } })
      )
      .mockResolvedValueOnce(new Response(null))
    render(ApiKeysSettings)
    await screen.findByText('No API keys have been created.')
    await user.type(screen.getByPlaceholderText('Automation server'), 'New')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await screen.findByText('secret')
    await user.click(screen.getByRole('button', { name: 'Revoke New' }))
    await waitFor(() => expect(screen.queryByText('secret')).not.toBeInTheDocument())
  })

  it('keeps a key and reports a revoke error', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(loadResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Cannot revoke owner key' }), { status: 400 })
      )
    render(ApiKeysSettings)
    await user.click(await screen.findByRole('button', { name: 'Revoke Automation' }))
    expect(await screen.findByText('Cannot revoke owner key')).toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(invalidateAll).not.toHaveBeenCalled()
  })
})
