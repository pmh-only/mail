// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import WindowControlsOverlay from './WindowControlsOverlay.svelte'

describe('WindowControlsOverlay', () => {
  it('renders the decorative Mail titlebar', () => {
    const { container } = render(WindowControlsOverlay)
    expect(screen.getByText('Mail')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})
