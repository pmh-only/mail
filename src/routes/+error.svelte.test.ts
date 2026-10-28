// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ErrorPage from './+error.svelte'

vi.mock('$app/state', () => ({ page: { status: 404 } }))

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('error page recovery', () => {
  it('links to the root route from a nested missing URL', () => {
    window.history.replaceState({}, '', '/share/bad/token')
    render(ErrorPage)

    for (const name of ['Mail home', 'Back to inbox']) {
      const link = screen.getByRole('link', { name }) as HTMLAnchorElement
      expect(link.pathname).toBe('/')
      expect(link.getAttribute('href')).toBe('/')
    }
  })

  it('uses browser history when a previous entry exists', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2)
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    render(ErrorPage)
    await fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(back).toHaveBeenCalledOnce()
  })
})
