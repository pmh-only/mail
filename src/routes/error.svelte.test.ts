// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { page } = vi.hoisted(() => ({ page: { status: 404 } }))
vi.mock('$app/state', () => ({ page }))

import ErrorPage from './+error.svelte'

describe('error page', () => {
  beforeEach(() => {
    page.status = 404
  })

  it('renders the not-found variant', () => {
    render(ErrorPage)
    expect(
      screen.getByRole('heading', { name: 'This page missed its destination.' })
    ).toBeInTheDocument()
    expect(screen.getByText('Return to sender')).toBeInTheDocument()
    expect(screen.getByText('Check the address and try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try loading/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathname: '/' })])
    )
  })

  it('renders the retryable server-error variant', () => {
    page.status = 500
    render(ErrorPage)
    expect(screen.getByRole('heading', { name: 'Delivery interrupted.' })).toBeInTheDocument()
    expect(screen.getByText('Service notice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try loading this page again' })).toBeInTheDocument()
    expect(screen.getByText('A quick retry usually does the trick.')).toBeInTheDocument()
  })

  it('uses browser history for Go back when available', async () => {
    const user = userEvent.setup()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    Object.defineProperty(window.history, 'length', { configurable: true, value: 2 })
    render(ErrorPage)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(back).toHaveBeenCalledOnce()
  })
})
