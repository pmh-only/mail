// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ActionModal from './ActionModal.svelte'

function props(overrides: Record<string, unknown> = {}) {
  return { title: 'Confirm action', onconfirm: vi.fn(), oncancel: vi.fn(), ...overrides }
}

describe('ActionModal', () => {
  it('renders defaults and confirms without a value', async () => {
    const user = userEvent.setup()
    const options = props()
    render(ActionModal, options)
    expect(screen.queryByText('message')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(options.onconfirm).toHaveBeenCalledWith(undefined)
  })

  it('renders custom labels, message, and danger styling', async () => {
    const user = userEvent.setup()
    const options = props({
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      tone: 'danger'
    })
    render(ActionModal, options)
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-rose-600')
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(options.oncancel).toHaveBeenCalledOnce()
  })

  it('initializes and submits a text input from the button', async () => {
    const user = userEvent.setup()
    const options = props({ inputLabel: 'Name', inputValue: 'Initial', inputType: 'search' })
    render(ActionModal, options)
    const input = screen.getByRole('searchbox', { name: 'Name' })
    expect(input).toHaveValue('Initial')
    await user.clear(input)
    await user.type(input, 'Updated')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(options.onconfirm).toHaveBeenCalledWith('Updated')
  })

  it('submits the input with Enter', async () => {
    const user = userEvent.setup()
    const options = props({ inputLabel: 'Value' })
    render(ActionModal, options)
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'payload{Enter}')
    expect(options.onconfirm).toHaveBeenCalledWith('payload')
  })

  it('cancels the input with Escape', async () => {
    const user = userEvent.setup()
    const options = props({ inputLabel: 'Value' })
    render(ActionModal, options)
    await user.type(screen.getByRole('textbox', { name: 'Value' }), '{Escape}')
    expect(options.oncancel).toHaveBeenCalledOnce()
  })
})
