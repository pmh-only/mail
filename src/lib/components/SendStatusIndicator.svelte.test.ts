// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import SendStatusIndicator from './SendStatusIndicator.svelte'

describe('SendStatusIndicator', () => {
  it.each([
    ['sending', null, 'Sending', 'amber', 'loader-circle'],
    ['failed', null, 'Failed', 'rose', 'circle-x'],
    ['sent', null, 'Sent', 'emerald', 'check'],
    ['sent', '2026-08-10T08:00:00Z', 'Read', 'sky', 'check-check']
  ] as const)('renders the %s state as %s', (status, openedAt, label, tone, icon) => {
    const { container } = render(SendStatusIndicator, { status, openedAt, size: 18 })

    const indicator = screen.getByRole('img', { name: label })
    expect(indicator).toHaveAttribute('data-app-tooltip', label)
    expect(indicator).toHaveClass(`text-${tone}-300`)
    expect(container.querySelector(`.lucide-${icon}`)).toHaveAttribute('width', '18')
  })
})
