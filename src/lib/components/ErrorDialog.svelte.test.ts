// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ErrorDialog from './ErrorDialog.svelte'

describe('ErrorDialog', () => {
  it('does not render or react to Escape without a message', async () => {
    const onclose = vi.fn()
    render(ErrorDialog, { message: null, onclose })

    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onclose).not.toHaveBeenCalled()
  })

  it('renders custom content and closes from its controls', async () => {
    const user = userEvent.setup()
    const onclose = vi.fn()
    render(ErrorDialog, { message: 'Unable to load mail', title: 'Mailbox error', onclose })

    expect(screen.getByRole('dialog', { name: 'Mailbox error' })).toHaveTextContent(
      'Unable to load mail'
    )

    await user.click(screen.getByRole('button', { name: 'Close error dialog' }))
    await user.click(screen.getByRole('button', { name: /^Close$/ }))
    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(onclose).toHaveBeenCalledTimes(3)
  })

  it('only closes when the backdrop itself is clicked', async () => {
    const user = userEvent.setup()
    const onclose = vi.fn()
    render(ErrorDialog, { message: 'Failure', onclose })

    await user.click(screen.getByRole('dialog'))
    expect(onclose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('presentation'))
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('allows an omitted close callback', async () => {
    const user = userEvent.setup()
    render(ErrorDialog, { message: 'Failure' })

    await user.click(screen.getByRole('button', { name: /^Close$/ }))
  })
})
