// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearOfflineCache, passkey } = vi.hoisted(() => ({
  clearOfflineCache: vi.fn(),
  passkey: vi.fn()
}))
vi.mock('$lib/auth-client', () => ({ authClient: { signIn: { passkey } } }))
vi.mock('$lib/offline-cache', () => ({ clearOfflineCache }))

import LoginPage from './+page.svelte'

function data(overrides: Record<string, boolean> = {}) {
  return {
    demoMode: false,
    themePreference: 'system' as const,
    themeStyle: { preset: 'off' as const, colors: ['#2563eb'], angle: 135 },
    methods: {
      password: false,
      passkey: false,
      github: false,
      discord: false,
      oidc: false,
      ...overrides
    }
  }
}

describe('login page', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/login')
    vi.stubGlobal('fetch', vi.fn())
    clearOfflineCache.mockReset().mockResolvedValue(undefined)
    passkey.mockReset()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage: vi.fn() } }
    })
  })

  it('renders only configured authentication methods', () => {
    render(LoginPage, {
      data: data({ password: true, passkey: true, github: true, discord: true, oidc: true })
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discord' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OpenID Connect' })).toBeInTheDocument()
    expect(screen.getByText('or continue with')).toBeInTheDocument()
  })

  it('renders no sign-in controls when no methods are enabled', () => {
    render(LoginPage, { data: data() })
    expect(screen.getByRole('heading', { name: 'Mail' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clears offline caches on mount', async () => {
    render(LoginPage, { data: data() })
    await waitFor(() => expect(clearOfflineCache).toHaveBeenCalledOnce())
    expect(navigator.serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
      type: 'CLEAR_OFFLINE_CACHE'
    })
  })

  it('shows and dismisses callback errors from the URL', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/login?error=access_denied')
    render(LoginPage, { data: data() })
    expect(await screen.findByRole('dialog', { name: 'Sign-in failed' })).toHaveTextContent(
      'access denied'
    )
    await user.click(screen.getByRole('button', { name: 'Close error dialog' }))
    expect(screen.queryByRole('dialog', { name: 'Sign-in failed' })).not.toBeInTheDocument()
  })

  it('submits trimmed password credentials and displays an API error', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 })
    )
    render(LoginPage, { data: data({ password: true }) })
    await user.type(screen.getByLabelText('Email'), '  user@example.com  ')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('dialog', { name: 'Sign-in failed' })).toHaveTextContent(
      'Invalid credentials'
    )
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'secret',
        rememberMe: true,
        callbackURL: '/'
      })
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('reports passkey result and thrown errors', async () => {
    const user = userEvent.setup()
    passkey.mockResolvedValueOnce({ error: { message: '' } })
    const { unmount } = render(LoginPage, { data: data({ passkey: true }) })
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Passkey sign-in failed.')
    expect(passkey).toHaveBeenCalledWith({ autoFill: false })
    unmount()

    passkey.mockRejectedValueOnce('Authenticator unavailable')
    render(LoginPage, { data: data({ passkey: true }) })
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Authenticator unavailable')
  })

  it('uses the social OAuth endpoint for GitHub', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'GitHub disabled' }), { status: 400 })
    )
    render(LoginPage, { data: data({ github: true }) })
    await user.click(screen.getByRole('button', { name: 'GitHub' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('GitHub disabled')
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/', errorCallbackURL: '/login' })
    })
  })

  it('uses generic OAuth2 payloads and rejects missing redirects', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}))
    render(LoginPage, { data: data({ oidc: true }) })
    await fireEvent.click(screen.getByRole('button', { name: 'OpenID Connect' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('No redirect URL returned.')
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'oidc', callbackURL: '/', errorCallbackURL: '/login' })
    })
  })
})
