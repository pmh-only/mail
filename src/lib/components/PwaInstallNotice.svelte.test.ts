// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PwaInstallNotice from './PwaInstallNotice.svelte'

type Query = MediaQueryList & { setMatches(value: boolean): void }

function installMatchMedia(initialMode: string | null = null) {
  const queries = new Map<string, Query>()
  const matchMedia = vi.fn((query: string) => {
    const existing = queries.get(query)
    if (existing) return existing
    let matches = query === `(display-mode: ${initialMode})`
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const value = {
      media: query,
      get matches() {
        return matches
      },
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener)
      ),
      removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener)
      ),
      dispatchEvent: vi.fn(),
      setMatches(next: boolean) {
        matches = next
        for (const listener of listeners)
          listener({ matches: next, media: query } as MediaQueryListEvent)
      }
    } as Query
    queries.set(query, value)
    return value
  })
  vi.stubGlobal('matchMedia', matchMedia)
  return queries
}

function beforeInstallPrompt(
  prompt = vi.fn().mockResolvedValue(undefined),
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> = Promise.resolve({
    outcome: 'accepted',
    platform: 'web'
  })
) {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice
  })
}

describe('PwaInstallNotice', () => {
  beforeEach(() => {
    localStorage.clear()
    installMatchMedia()
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
  })

  it('shows browser-menu guidance by default and dismisses it', async () => {
    const user = userEvent.setup()
    render(PwaInstallNotice)
    expect(await screen.findByLabelText('Install Mail app')).toHaveTextContent(
      'Install Mail from your browser menu'
    )
    expect(document.documentElement).toHaveClass('pwa-install-notice-visible')
    await user.click(screen.getByRole('button', { name: 'Dismiss install notice' }))
    expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument()
    expect(localStorage.getItem('mail:pwa-install-notice-dismissed')).toBe('true')
    expect(document.documentElement).not.toHaveClass('pwa-install-notice-visible')
  })

  it('stays hidden after dismissal', async () => {
    localStorage.setItem('mail:pwa-install-notice-dismissed', 'true')
    render(PwaInstallNotice)
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
  })

  it.each(['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'])(
    'stays hidden in %s display mode',
    async (mode) => {
      installMatchMedia(mode)
      render(PwaInstallNotice)
      await waitFor(() =>
        expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument()
      )
    }
  )

  it('stays hidden in iOS standalone mode', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    render(PwaInstallNotice)
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
  })

  it('captures the install prompt and completes installation', async () => {
    const user = userEvent.setup()
    const prompt = vi.fn().mockResolvedValue(undefined)
    render(PwaInstallNotice)
    const event = beforeInstallPrompt(prompt)
    window.dispatchEvent(event)

    const install = await screen.findByRole('button', { name: 'Install' })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('Install Mail app')).toHaveTextContent(
      'Install Mail for faster access'
    )
    await user.click(install)
    expect(prompt).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
    expect(localStorage.getItem('mail:pwa-install-notice-dismissed')).toBe('true')
  })

  it('disables the install action while user choice is pending', async () => {
    const user = userEvent.setup()
    let resolveChoice!: (choice: { outcome: 'accepted'; platform: string }) => void
    const choice = new Promise<{ outcome: 'accepted'; platform: string }>((resolve) => {
      resolveChoice = resolve
    })
    render(PwaInstallNotice)
    window.dispatchEvent(beforeInstallPrompt(vi.fn(), choice))
    await user.click(await screen.findByRole('button', { name: 'Install' }))
    expect(screen.getByRole('button', { name: 'Installing...' })).toBeDisabled()
    resolveChoice({ outcome: 'accepted', platform: 'web' })
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
  })

  it('falls back to menu guidance when prompting fails', async () => {
    const user = userEvent.setup()
    render(PwaInstallNotice)
    window.dispatchEvent(beforeInstallPrompt(vi.fn().mockRejectedValue(new Error('gone'))))
    await user.click(await screen.findByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Install Mail app')).toHaveTextContent('browser menu')
    )
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
  })

  it('hides when installation completes', async () => {
    render(PwaInstallNotice)
    expect(await screen.findByLabelText('Install Mail app')).toBeInTheDocument()
    window.dispatchEvent(new Event('appinstalled'))
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
  })

  it('reacts when an installed display mode becomes active', async () => {
    const queries = installMatchMedia()
    render(PwaInstallNotice)
    expect(await screen.findByLabelText('Install Mail app')).toBeInTheDocument()
    queries.get('(display-mode: standalone)')?.setMatches(true)
    await waitFor(() => expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument())
  })

  it('tolerates unavailable local storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(PwaInstallNotice)
    await user.click(await screen.findByRole('button', { name: 'Dismiss install notice' }))
    expect(screen.queryByLabelText('Install Mail app')).not.toBeInTheDocument()
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('removes browser listeners and the root class when destroyed', async () => {
    const queries = installMatchMedia()
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(PwaInstallNotice)
    await screen.findByLabelText('Install Mail app')
    unmount()
    expect(removeWindowListener).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith('appinstalled', expect.any(Function))
    for (const query of queries.values()) expect(query.removeEventListener).toHaveBeenCalled()
    expect(document.documentElement).not.toHaveClass('pwa-install-notice-visible')
  })
})
