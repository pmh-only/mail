// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { Star } from 'lucide-svelte'
import { describe, expect, it, vi } from 'vitest'
import MobileMailActions from './MobileMailActions.svelte'

function actions() {
  return [
    { label: 'Archive', icon: Star, onSelect: vi.fn(), group: 'move' },
    {
      label: 'Delete',
      icon: Star,
      onSelect: vi.fn(),
      disabled: true,
      iconClass: 'text-rose-300',
      group: 'danger'
    }
  ]
}

describe('MobileMailActions', () => {
  it('opens and closes the action menu', async () => {
    const user = userEvent.setup()
    render(MobileMailActions, { actions: actions() })
    const trigger = screen.getByRole('button', { name: 'Mail actions' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders grouped and disabled actions', async () => {
    const user = userEvent.setup()
    const { container } = render(MobileMailActions, { actions: actions() })
    await user.click(screen.getByRole('button', { name: 'Mail actions' }))

    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
    expect(container.querySelector('.border-t')).toBeInTheDocument()
    expect(container.querySelector('.text-rose-300')).toBeInTheDocument()
  })

  it('selects an enabled action and closes the menu', async () => {
    const user = userEvent.setup()
    const items = actions()
    render(MobileMailActions, { actions: items })
    await user.click(screen.getByRole('button', { name: 'Mail actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))

    expect(items[0].onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('dismisses on outside pointer interaction and Escape', async () => {
    const user = userEvent.setup()
    render(MobileMailActions, { actions: actions() })
    const trigger = screen.getByRole('button', { name: 'Mail actions' })

    await user.click(trigger)
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
