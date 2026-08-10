// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MarkActions from './MarkActions.svelte'

function props(overrides: Record<string, unknown> = {}) {
  return {
    onMarkUnread: vi.fn(),
    onToggleStar: vi.fn(),
    onTogglePin: vi.fn(),
    starred: false,
    pinned: false,
    ...overrides
  }
}

describe('MarkActions', () => {
  it('disables the trigger when requested', () => {
    render(MarkActions, props({ disabled: true }))
    expect(screen.getByRole('button', { name: 'Other actions' })).toBeDisabled()
  })

  it('renders toggled labels and optional actions', async () => {
    const user = userEvent.setup()
    render(
      MarkActions,
      props({
        starred: true,
        pinned: true,
        onSnooze: vi.fn(),
        onViewRaw: vi.fn(),
        onViewMetadata: vi.fn(),
        rawSourceAvailable: true
      })
    )
    await user.click(screen.getByRole('button', { name: 'Other actions' }))

    expect(screen.getByRole('menuitem', { name: 'Mark as unstarred' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Mark as unpinned' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Snooze' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View raw message' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'View metadata' })).toBeInTheDocument()
  })

  it('shows an unavailable raw-source action', async () => {
    const user = userEvent.setup()
    render(MarkActions, props({ onViewRaw: vi.fn() }))
    await user.click(screen.getByRole('button', { name: 'Other actions' }))
    expect(screen.getByRole('menuitem', { name: 'Raw unavailable' })).toBeDisabled()
  })

  it.each([
    ['Mark as unread', 'onMarkUnread'],
    ['Mark as starred', 'onToggleStar'],
    ['Mark as pinned', 'onTogglePin'],
    ['Snooze', 'onSnooze'],
    ['View raw message', 'onViewRaw'],
    ['View metadata', 'onViewMetadata']
  ] as const)('runs %s and closes', async (label, callback) => {
    const user = userEvent.setup()
    const callbacks = {
      onMarkUnread: vi.fn(),
      onToggleStar: vi.fn(),
      onTogglePin: vi.fn(),
      onSnooze: vi.fn(),
      onViewRaw: vi.fn(),
      onViewMetadata: vi.fn()
    }
    render(MarkActions, props({ ...callbacks, rawSourceAvailable: true }))
    await user.click(screen.getByRole('button', { name: 'Other actions' }))
    await user.click(screen.getByRole('menuitem', { name: label }))

    expect(callbacks[callback]).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('toggles and dismisses the menu by keyboard and outside pointer', async () => {
    const user = userEvent.setup()
    render(MarkActions, props())
    const trigger = screen.getByRole('button', { name: 'Other actions' })
    await user.click(trigger)
    await fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
