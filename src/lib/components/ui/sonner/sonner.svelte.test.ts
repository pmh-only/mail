// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sonner from './sonner.svelte'

describe('Sonner', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    )
  })

  it('renders the shared accessible notification region', () => {
    render(Sonner, { position: 'bottom-left', visibleToasts: 4 })
    const toaster = screen.getByLabelText('Notifications alt+T')
    expect(toaster).toHaveAttribute('aria-live', 'polite')
    expect(toaster.tagName).toBe('SECTION')
  })
})
