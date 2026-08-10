// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { tick } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddressInput from './AddressInput.svelte'

function input() {
  return screen.getByRole('combobox') as HTMLInputElement
}

async function enterPartial(value: string) {
  await fireEvent.input(input(), { target: { value } })
}

async function loadSuggestions(payload: Record<string, unknown>, query = 'a') {
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(Response.json(payload)))
  vi.useFakeTimers()
  await enterPartial(query)
  await vi.advanceTimersByTimeAsync(200)
  await tick()
  vi.useRealTimers()
}

describe('AddressInput', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ contacts: [], groups: [] })))
    )
  )

  it('renders default and custom field metadata', () => {
    const { unmount } = render(AddressInput, { value: '' })
    expect(screen.getByRole('combobox', { name: 'Recipient' })).toHaveAttribute(
      'placeholder',
      'recipient@example.com'
    )
    expect(input()).not.toHaveAttribute('aria-controls')
    unmount()

    render(AddressInput, {
      value: '',
      id: 'to-field',
      label: 'To',
      placeholder: 'name@example.com'
    })
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveAttribute(
      'aria-controls',
      'to-field-listbox'
    )
    expect(input()).toHaveAttribute('placeholder', 'name@example.com')
  })

  it('renders initial recipients and removes them', async () => {
    const user = userEvent.setup()
    render(AddressInput, { value: 'Alice <alice@example.com>, bob@example.com' })
    expect(screen.getByText('Alice <alice@example.com>')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    const remove = screen.getAllByRole('button', { name: 'Remove' })
    await user.click(remove[0])
    expect(screen.queryByText('Alice <alice@example.com>')).not.toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('marks malformed recipients as invalid', () => {
    const { container } = render(AddressInput, { value: 'not-an-address' })
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Invalid recipient: not-an-address')).toBeInTheDocument()
    expect(container.querySelector('[data-app-tooltip]')).toHaveClass('text-rose-100')
  })

  it('updates pills when the external value changes', async () => {
    const view = render(AddressInput, { value: 'first@example.com' })
    expect(screen.getByText('first@example.com')).toBeInTheDocument()
    await view.rerender({ value: 'second@example.com' })
    expect(screen.queryByText('first@example.com')).not.toBeInTheDocument()
    expect(screen.getByText('second@example.com')).toBeInTheDocument()
  })

  it('adds one or multiple recipients with Enter', async () => {
    render(AddressInput, { value: '' })
    await enterPartial('alice@example.com, Bob <bob@example.com>')
    await fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('Bob <bob@example.com>')).toBeInTheDocument()
    expect(input()).toHaveValue('')
  })

  it('does not add duplicates by normalized email', async () => {
    render(AddressInput, { value: 'Alice <ALICE@example.com>' })
    await enterPartial('alice@example.com')
    await fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    expect(input()).toHaveValue('')
  })

  it.each([',', ' '])('confirms an email with %s', async (key) => {
    render(AddressInput, { value: '' })
    await enterPartial('alice@example.com')
    await fireEvent.keyDown(input(), { key })
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('does not confirm ordinary text with a separator', async () => {
    render(AddressInput, { value: '' })
    await enterPartial('Alice')
    await fireEvent.keyDown(input(), { key: ',' })
    expect(input()).toHaveValue('Alice')
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('removes the last pill with Backspace only when partial input is empty', async () => {
    render(AddressInput, { value: 'one@example.com, two@example.com' })
    await enterPartial('draft')
    await fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    await enterPartial('')
    await fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  })

  it('commits partial input after blur', async () => {
    vi.useFakeTimers()
    try {
      render(AddressInput, { value: '' })
      await enterPartial('blur@example.com')
      await fireEvent.blur(input())
      await vi.advanceTimersByTimeAsync(150)
      await tick()
      expect(screen.getByText('blur@example.com')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads contacts, supports keyboard navigation, and selects one', async () => {
    render(AddressInput, { value: '', id: 'to' })
    await loadSuggestions({
      contacts: [
        { name: 'Alice', email: 'alice@example.com', display: 'Alice <alice@example.com>' },
        { name: '', email: 'bob@example.com', display: 'bob@example.com' }
      ]
    })
    expect(fetch).toHaveBeenCalledWith('/api/contacts?includeGroups=1&q=a')
    expect(screen.getByRole('listbox')).toHaveAttribute('id', 'to-listbox')
    expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'bob@example.com' })).toBeInTheDocument()

    await fireEvent.keyDown(input(), { key: 'ArrowDown' })
    await fireEvent.keyDown(input(), { key: 'ArrowDown' })
    await fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'bob@example.com' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await fireEvent.keyDown(input(), { key: 'ArrowUp' })
    await fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByText('Alice <alice@example.com>')).toBeInTheDocument()
    expect(input()).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects a group and de-duplicates its members', async () => {
    render(AddressInput, { value: 'alice@example.com' })
    await loadSuggestions({
      groups: [
        {
          id: 5,
          name: 'Team',
          display: 'Team',
          members: [
            { name: 'Alice', email: 'alice@example.com', display: 'Alice <alice@example.com>' },
            { name: 'Bob', email: 'bob@example.com', display: 'Bob <bob@example.com>' }
          ]
        }
      ]
    })
    expect(screen.getByText('Group · 2')).toBeInTheDocument()
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Team/ }))
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    expect(screen.getByText('Bob <bob@example.com>')).toBeInTheDocument()
  })

  it('keeps suggestions hidden for failed and empty searches', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }))
    render(AddressInput, { value: '' })
    vi.useFakeTimers()
    try {
      await enterPartial('failed')
      await vi.advanceTimersByTimeAsync(200)
      await tick()
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      await enterPartial('')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dismisses suggestions with Escape', async () => {
    render(AddressInput, { value: '' })
    await loadSuggestions({
      contacts: [{ name: 'Alice', email: 'alice@example.com', display: 'alice@example.com' }]
    })
    await fireEvent.keyDown(input(), { key: 'ArrowDown' })
    await fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('adds typed text with Enter when no suggestion is highlighted', async () => {
    render(AddressInput, { value: '' })
    await loadSuggestions({
      contacts: [{ name: 'Alice', email: 'alice@example.com', display: 'alice@example.com' }]
    })
    await fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByText('a')).toBeInTheDocument()
  })
})
