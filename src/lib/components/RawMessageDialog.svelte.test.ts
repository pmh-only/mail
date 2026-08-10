// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RawMessageDialog from './RawMessageDialog.svelte'

function success(source = 'From: sender@example.com\r\n\r\nHello') {
  return new Response(source)
}

describe('RawMessageDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success()))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('shows loading before rendering raw source controls', async () => {
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve
      })
    )
    render(RawMessageDialog, { messageId: 42, subject: 'Subject', onclose: vi.fn() })
    expect(screen.getByRole('status')).toHaveTextContent('Loading raw source...')
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument()

    resolveResponse(success('raw source'))
    expect(await screen.findByText('raw source')).toBeInTheDocument()
  })

  it('loads source and exposes download metadata', async () => {
    render(RawMessageDialog, { messageId: 42, subject: 'Subject', onclose: vi.fn() })
    expect(await screen.findByText(/From: sender@example.com/)).toBeInTheDocument()
    const download = screen.getByRole('link', { name: /Download .eml/ })
    expect(download).toHaveAttribute('href', '/api/messages/42/raw')
    expect(download).toHaveAttribute('download', 'message-42.eml')
    expect(screen.getByText(/Subject · decoded preview/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/messages/42/raw', { signal: expect.any(AbortSignal) })
  })

  it('uses the no-subject fallback', async () => {
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    expect(await screen.findByText(/\(no subject\) · decoded preview/)).toBeInTheDocument()
  })

  it('renders an HTTP error response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Raw access denied' }), { status: 403 })
    )
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    expect(await screen.findByRole('alert')).toHaveTextContent('Raw access denied')
  })

  it.each([
    [new Error('Network failed'), 'Network failed'],
    ['unknown failure', 'Raw source unavailable.']
  ])('renders fetch failures', async (reason, message) => {
    vi.mocked(fetch).mockRejectedValue(reason)
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('copies source and resets the copied state', async () => {
    vi.useFakeTimers()
    try {
      render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
      await screen.findByText(/From: sender@example.com/)
      await fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'From: sender@example.com\r\n\r\nHello'
      )
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
      expect(screen.getByText('Raw source copied.')).toBeInTheDocument()
      vi.advanceTimersByTime(1500)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a previous copy timer when copied twice', async () => {
    vi.useFakeTimers()
    try {
      render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
      await screen.findByText(/From: sender@example.com/)
      await fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Copied' }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports clipboard failure', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Denied'))
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    await screen.findByText(/From: sender@example.com/)
    await fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(await screen.findByText('Could not copy the raw source.')).toBeInTheDocument()
  })

  it('closes from the button, backdrop, and Escape only', async () => {
    const user = userEvent.setup()
    const onclose = vi.fn()
    render(RawMessageDialog, { messageId: 1, onclose })
    const dialog = screen.getByRole('dialog')
    await user.click(dialog)
    expect(onclose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('presentation'))
    await user.click(screen.getByRole('button', { name: 'Close raw message' }))
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(onclose).toHaveBeenCalledTimes(3)
  })

  it('traps forward and backward Tab focus', async () => {
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    await screen.findByText(/From: sender@example.com/)
    const dialog = screen.getByRole('dialog')
    const first = screen.getByRole('link', { name: /Download/ })
    const last = screen.getByRole('button', { name: 'Close raw message' })

    last.focus()
    await fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    dialog.focus()
    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('keeps focus in the dialog when no focusable controls remain', async () => {
    render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    const dialog = screen.getByRole('dialog')
    screen.getByRole('button', { name: 'Close raw message' }).setAttribute('disabled', '')
    dialog.focus()
    await fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog).toHaveFocus()
  })

  it('restores focus and aborts loading when destroyed', async () => {
    const prior = document.createElement('button')
    document.body.append(prior)
    prior.focus()
    let capturedSignal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation((_input, init) => {
      capturedSignal = init?.signal as AbortSignal
      return new Promise(() => undefined)
    })
    const { unmount } = render(RawMessageDialog, { messageId: 1, onclose: vi.fn() })
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
    unmount()
    expect(capturedSignal?.aborted).toBe(true)
    expect(prior).toHaveFocus()
    prior.remove()
  })
})
