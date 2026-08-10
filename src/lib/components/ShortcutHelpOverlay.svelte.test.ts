// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { shortcutHelpGroups } from '$lib/shortcut-help'
import ShortcutHelpOverlay from './ShortcutHelpOverlay.svelte'

describe('ShortcutHelpOverlay', () => {
  it('stays absent while closed', () => {
    render(ShortcutHelpOverlay, { open: false, onclose: vi.fn() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders every shortcut group and row', () => {
    render(ShortcutHelpOverlay, { open: true, onclose: vi.fn() })
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Shortcut help')
    for (const group of shortcutHelpGroups) {
      expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument()
      for (const row of group.rows) expect(screen.getAllByText(row.desc).length).toBeGreaterThan(0)
    }
  })

  it('closes from both controls', async () => {
    const user = userEvent.setup()
    const onclose = vi.fn()
    render(ShortcutHelpOverlay, { open: true, onclose })
    const closeButtons = screen.getAllByRole('button', { name: 'Close keyboard shortcut help' })
    await user.click(closeButtons[0])
    await user.click(closeButtons[1])
    expect(onclose).toHaveBeenCalledTimes(2)
  })
})
