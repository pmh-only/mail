// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import MailAuthenticationIndicators from './MailAuthenticationIndicators.svelte'

describe('MailAuthenticationIndicators', () => {
  it('shows passing checks and the default trust warning', () => {
    render(MailAuthenticationIndicators, {
      spfStatus: 'pass',
      dkimStatus: 'pass',
      dmarcStatus: 'pass'
    })

    const button = screen.getByRole('button', { name: 'Email authentication pass' })
    expect(button).toHaveClass('text-emerald-300', 'border-dashed', 'px-2')
    expect(button).toHaveAttribute('aria-describedby')

    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getAllByText('pass')).toHaveLength(3)
    expect(tooltip).toHaveTextContent('Not reported by a trusted receiving service')
  })

  it('renders compact trusted failures without DKIM', () => {
    render(MailAuthenticationIndicators, {
      spfStatus: 'fail',
      dkimStatus: 'pass',
      dmarcStatus: 'permerror',
      authenticationTrusted: true,
      compact: true,
      showDkim: false
    })

    const button = screen.getByRole('button', { name: 'Email authentication fail' })
    expect(button).toHaveClass('text-rose-300', 'px-1.5')
    expect(button).not.toHaveClass('border-dashed')

    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).queryByText('DKIM')).not.toBeInTheDocument()
    expect(tooltip).toHaveTextContent('perm error')
    expect(tooltip).toHaveTextContent('Reported by a trusted receiving service')
  })

  it('shows an unknown neutral state', () => {
    render(MailAuthenticationIndicators)

    expect(screen.getByRole('button', { name: 'Email authentication none' })).toHaveClass(
      'text-zinc-400'
    )
    expect(screen.getAllByText('unknown')).toHaveLength(3)
  })
})
