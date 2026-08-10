// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { shouldOpenPopoverAbove } = vi.hoisted(() => ({ shouldOpenPopoverAbove: vi.fn() }))
vi.mock('$lib/popover', () => ({ shouldOpenPopoverAbove }))

import CustomSelect from './CustomSelect.svelte'

const options = [
  { value: 'one', label: 'First option' },
  { value: 'disabled', label: 'Disabled option', disabled: true },
  { value: 3, label: 'Third option' }
]

function props(overrides: Record<string, unknown> = {}) {
  return {
    id: 'choice',
    value: 'one',
    options,
    ariaLabel: 'Choose value',
    onchange: vi.fn(),
    ...overrides
  }
}

describe('CustomSelect', () => {
  beforeEach(() => shouldOpenPopoverAbove.mockReturnValue(false))

  it('renders the selected option and custom classes', () => {
    const { container } = render(
      CustomSelect,
      props({ class: 'outer-class', buttonClass: 'button-class' })
    )
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    expect(combobox).toHaveTextContent('First option')
    expect(combobox).toHaveClass('button-class')
    expect(combobox).toHaveAttribute('aria-controls', 'choice-listbox')
    expect(container.firstElementChild).toHaveClass('outer-class')
  })

  it('falls back to the first option and a generated id', () => {
    render(CustomSelect, {
      value: 'missing',
      options,
      ariaLabel: 'Delivery Mode!'
    })
    const combobox = screen.getByRole('combobox', { name: 'Delivery Mode!' })
    expect(combobox).toHaveTextContent('First option')
    expect(combobox).toHaveAttribute('aria-controls', 'custom-select-delivery-mode--listbox')
  })

  it('does not open when disabled or without enabled options', async () => {
    const user = userEvent.setup()
    const { unmount } = render(CustomSelect, props({ disabled: true }))
    const disabled = screen.getByRole('combobox', { name: 'Choose value' })
    expect(disabled).toBeDisabled()
    await user.click(disabled)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    unmount()

    render(CustomSelect, props({ options: [{ value: 'x', label: 'Blocked', disabled: true }] }))
    await user.click(screen.getByRole('combobox', { name: 'Choose value' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens below and closes on a second click', async () => {
    const user = userEvent.setup()
    render(CustomSelect, props({ menuClass: 'menu-class' }))
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await user.click(combobox)
    expect(screen.getByRole('listbox')).toHaveClass('top-full', 'menu-class')
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-0')
    await user.click(combobox)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('positions the menu above when space is constrained', async () => {
    shouldOpenPopoverAbove.mockReturnValue(true)
    const user = userEvent.setup()
    render(CustomSelect, props())
    await user.click(screen.getByRole('combobox', { name: 'Choose value' }))
    expect(await screen.findByRole('listbox')).toHaveClass('bottom-full')
    expect(shouldOpenPopoverAbove).toHaveBeenCalled()
  })

  it('selects an option, invokes onchange, and restores focus', async () => {
    const user = userEvent.setup()
    const onchange = vi.fn()
    render(CustomSelect, props({ onchange }))
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await user.click(combobox)
    await user.click(screen.getByRole('option', { name: 'Third option' }))
    expect(onchange).toHaveBeenCalledWith(3)
    expect(combobox).toHaveTextContent('Third option')
    expect(combobox).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('moves through enabled options with Arrow keys and wraps', async () => {
    render(CustomSelect, props())
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-2')
    await fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-0')
    await fireEvent.keyDown(combobox, { key: 'ArrowUp' })
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-2')
  })

  it('moves to first and last enabled boundaries', async () => {
    render(CustomSelect, props())
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await fireEvent.keyDown(combobox, { key: 'End' })
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-2')
    await fireEvent.keyDown(combobox, { key: 'Home' })
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-0')
  })

  it('opens and selects with Enter and Space', async () => {
    const onchange = vi.fn()
    render(CustomSelect, props({ onchange }))
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await fireEvent.keyDown(combobox, { key: 'Enter' })
    await fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    await fireEvent.keyDown(combobox, { key: ' ' })
    expect(onchange).toHaveBeenCalledWith(3)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it.each(['Tab', 'Escape'])('closes with %s', async (key) => {
    const user = userEvent.setup()
    render(CustomSelect, props())
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await user.click(combobox)
    await fireEvent.keyDown(combobox, { key })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports typeahead and clears its search buffer', async () => {
    vi.useFakeTimers()
    try {
      render(CustomSelect, props())
      const combobox = screen.getByRole('combobox', { name: 'Choose value' })
      await fireEvent.keyDown(combobox, { key: 't' })
      expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-2')
      await fireEvent.keyDown(combobox, { key: 'h' })
      vi.advanceTimersByTime(700)
      await fireEvent.keyDown(combobox, { key: 'f' })
      expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores modified printable keys', async () => {
    render(CustomSelect, props())
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await fireEvent.keyDown(combobox, { key: 't', ctrlKey: true })
    await fireEvent.keyDown(combobox, { key: 't', altKey: true })
    await fireEvent.keyDown(combobox, { key: 't', metaKey: true })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('activates an option on pointer hover', async () => {
    const user = userEvent.setup()
    render(CustomSelect, props())
    const combobox = screen.getByRole('combobox', { name: 'Choose value' })
    await user.click(combobox)
    await fireEvent.mouseEnter(screen.getByRole('option', { name: 'Third option' }))
    expect(combobox).toHaveAttribute('aria-activedescendant', 'choice-listbox-option-2')
  })

  it('dismisses on an outside pointer interaction', async () => {
    const user = userEvent.setup()
    render(CustomSelect, props())
    await user.click(screen.getByRole('combobox', { name: 'Choose value' }))
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
