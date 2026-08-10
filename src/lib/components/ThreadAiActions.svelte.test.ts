// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ThreadAiActions from './ThreadAiActions.svelte'

function props(overrides: Record<string, unknown> = {}) {
  return { onSummarize: vi.fn(), onExtractActions: vi.fn(), ...overrides }
}

describe('ThreadAiActions', () => {
  it('toggles the action menu', async () => {
    const user = userEvent.setup()
    render(ThreadAiActions, props())
    const trigger = screen.getByRole('button', { name: 'AI thread actions' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    ['Summarize thread', 'onSummarize'],
    ['Extract thread actions', 'onExtractActions']
  ] as const)('runs %s', async (label, callback) => {
    const user = userEvent.setup()
    const options = props()
    render(ThreadAiActions, options)
    await user.click(screen.getByRole('button', { name: 'AI thread actions' }))
    await user.click(screen.getByRole('menuitem', { name: label }))
    expect(options[callback]).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders both busy states', async () => {
    const user = userEvent.setup()
    render(ThreadAiActions, props({ summarizing: true, extracting: true }))
    await user.click(screen.getByRole('button', { name: 'AI thread actions' }))
    expect(screen.getByRole('menuitem', { name: 'Summarizing...' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Extracting...' })).toBeDisabled()
  })

  it('dismisses using Escape and an outside pointer', async () => {
    const user = userEvent.setup()
    render(ThreadAiActions, props())
    const trigger = screen.getByRole('button', { name: 'AI thread actions' })
    await user.click(trigger)
    await fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(trigger)
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
