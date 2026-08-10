// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { shouldOpenPopoverAbove } = vi.hoisted(() => ({ shouldOpenPopoverAbove: vi.fn() }))
vi.mock('$lib/popover', () => ({ shouldOpenPopoverAbove }))

import ReplyActions from './ReplyActions.svelte'

function props(overrides: Record<string, unknown> = {}) {
  return {
    onReply: vi.fn(),
    onReplyAll: vi.fn(),
    onAiReply: vi.fn(),
    ...overrides
  }
}

describe('ReplyActions', () => {
  beforeEach(() => shouldOpenPopoverAbove.mockReturnValue(false))

  it('renders the labelled default trigger and toggles its menu', async () => {
    const user = userEvent.setup()
    render(ReplyActions, props())
    const trigger = screen.getByRole('button', { name: 'Reply options' })

    expect(trigger).toHaveTextContent('Reply')
    await user.click(trigger)
    expect(screen.getByRole('menu')).toHaveClass('top-full', 'left-0')
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('supports icon-only positioning above the trigger', async () => {
    shouldOpenPopoverAbove.mockReturnValue(true)
    const user = userEvent.setup()
    render(ReplyActions, props({ iconOnly: true }))
    const trigger = screen.getByRole('button', { name: 'Reply options' })
    expect(trigger).not.toHaveTextContent('Reply')

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toHaveClass('bottom-full', 'right-0')
    expect(shouldOpenPopoverAbove).toHaveBeenCalled()
  })

  it.each([
    ['Reply', 'onReply'],
    ['Reply all', 'onReplyAll']
  ] as const)('runs the %s callback', async (label, callback) => {
    const user = userEvent.setup()
    const options = props()
    render(ReplyActions, options)
    await user.click(screen.getByRole('button', { name: 'Reply options' }))
    await user.click(screen.getByRole('menuitem', { name: label }))

    expect(options[callback]).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('hides AI actions unless enabled', async () => {
    const user = userEvent.setup()
    render(ReplyActions, props())
    await user.click(screen.getByRole('button', { name: 'Reply options' }))
    expect(screen.queryByRole('menuitem', { name: /AI reply/ })).not.toBeInTheDocument()
  })

  it('runs an enabled AI reply and renders the drafting state', async () => {
    const user = userEvent.setup()
    const enabled = props({ aiEnabled: true })
    const { unmount } = render(ReplyActions, enabled)
    await user.click(screen.getByRole('button', { name: 'Reply options' }))
    await user.click(screen.getByRole('menuitem', { name: 'AI reply draft' }))
    expect(enabled.onAiReply).toHaveBeenCalledOnce()
    unmount()

    render(ReplyActions, props({ aiEnabled: true, drafting: true }))
    await user.click(screen.getByRole('button', { name: 'Reply options' }))
    expect(screen.getByRole('menuitem', { name: 'Drafting...' })).toBeDisabled()
  })

  it('dismisses with Escape and outside interaction', async () => {
    const user = userEvent.setup()
    render(ReplyActions, props())
    const trigger = screen.getByRole('button', { name: 'Reply options' })

    await user.click(trigger)
    await fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
