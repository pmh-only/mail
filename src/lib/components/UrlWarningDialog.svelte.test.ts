// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UrlWarningDialog from './UrlWarningDialog.svelte'

function props(url = 'https://example.com/account') {
  return { url, oncancel: vi.fn(), oncontinue: vi.fn() }
}

describe('UrlWarningDialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
  })

  it.each([
    ['https://example.com/account', 'example.com'],
    ['mailto:user@example.com', 'mailto'],
    ['not a valid URL', 'not a valid URL']
  ])('shows destination for %s', (url, destination) => {
    render(UrlWarningDialog, props(url))
    expect(screen.getByRole('alertdialog')).toHaveAttribute('open')
    expect(screen.getByText(destination, { selector: '[data-app-tooltip]' })).toHaveAttribute(
      'data-app-tooltip',
      destination
    )
    expect(screen.getAllByText(url).length).toBeGreaterThan(0)
  })

  it('focuses Go back and closes the native dialog on destroy', () => {
    const { unmount } = render(UrlWarningDialog, props())
    expect(screen.getByRole('button', { name: 'Go back' })).toHaveFocus()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    unmount()
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce()
  })

  it('runs both action callbacks', async () => {
    const user = userEvent.setup()
    const options = props()
    render(UrlWarningDialog, options)
    await user.click(screen.getByRole('button', { name: 'Open link' }))
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.click(screen.getByRole('button', { name: 'Close URL warning' }))
    expect(options.oncontinue).toHaveBeenCalledOnce()
    expect(options.oncancel).toHaveBeenCalledTimes(2)
  })

  it('cancels the native dialog event', async () => {
    const options = props()
    render(UrlWarningDialog, options)
    const event = new Event('cancel', { cancelable: true })
    screen.getByRole('alertdialog').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(options.oncancel).toHaveBeenCalledOnce()
  })

  it('handles Escape but ignores other keys', async () => {
    const options = props()
    render(UrlWarningDialog, options)
    const dialog = screen.getByRole('alertdialog')
    await fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(options.oncancel).not.toHaveBeenCalled()
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(options.oncancel).toHaveBeenCalledOnce()
  })

  it('only treats a direct dialog click as backdrop interaction', async () => {
    const user = userEvent.setup()
    const options = props()
    render(UrlWarningDialog, options)
    await user.click(screen.getByText('Destination'))
    expect(options.oncancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('alertdialog'))
    expect(options.oncancel).toHaveBeenCalledOnce()
  })
})
