// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import OpenPgpIndicator from './OpenPgpIndicator.svelte'

describe('OpenPgpIndicator', () => {
  it('renders nothing without signed or encrypted content', () => {
    render(OpenPgpIndicator)
    expect(screen.queryByLabelText('OpenPGP security')).not.toBeInTheDocument()
  })

  it.each([
    ['valid', 'Verified OpenPGP signature', 'text-emerald-300', 'shield-check'],
    ['valid-untrusted', 'Valid OpenPGP signature from an untrusted key', 'text-sky-300', null],
    ['valid-mismatch', 'Valid signature, but signer does not match From', 'text-amber-200', null],
    ['invalid', 'Invalid OpenPGP signature', 'text-rose-300', 'shield-x'],
    [null, 'OpenPGP signature could not be verified', 'text-amber-200', null]
  ] as const)('renders the %s signature state', (signatureStatus, label, tone, icon) => {
    const { container } = render(OpenPgpIndicator, {
      signed: true,
      signatureStatus,
      signer: 'Alice <alice@example.com>',
      fingerprint: 'ABCD',
      error: 'details'
    })
    const indicator = screen.getByText(label)
    expect(indicator).toHaveClass(tone)
    expect(indicator).toHaveAttribute(
      'data-app-tooltip',
      expect.stringContaining('Fingerprint: ABCD')
    )
    expect(indicator.querySelector('svg')).toBeInTheDocument()
    if (icon) expect(container.querySelector(`.lucide-${icon}`)).toBeInTheDocument()
  })

  it.each([
    ['valid', 'PGP verified'],
    ['valid-untrusted', 'PGP untrusted'],
    ['valid-mismatch', 'PGP mismatch'],
    ['invalid', 'PGP invalid'],
    [null, 'PGP unknown']
  ] as const)('uses the compact %s label', (signatureStatus, label) => {
    const { container } = render(OpenPgpIndicator, {
      signed: true,
      signatureStatus,
      compact: true
    })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('width', '11')
  })

  it('renders successful decryption', () => {
    render(OpenPgpIndicator, { encrypted: true, decrypted: true })
    expect(screen.getByText('PGP decrypted')).toHaveAttribute(
      'data-app-tooltip',
      'OpenPGP message decrypted successfully'
    )
  })

  it('renders a decryption error and fallback', () => {
    const { unmount } = render(OpenPgpIndicator, { encrypted: true, error: 'Missing key' })
    expect(screen.getByText('PGP encrypted')).toHaveAttribute('data-app-tooltip', 'Missing key')
    unmount()
    render(OpenPgpIndicator, { encrypted: true })
    expect(screen.getByText('PGP encrypted')).toHaveAttribute(
      'data-app-tooltip',
      'Unable to decrypt OpenPGP message'
    )
  })

  it('renders signed and encrypted states together', () => {
    render(OpenPgpIndicator, { signed: true, signatureStatus: 'valid', encrypted: true })
    const security = screen.getByLabelText('OpenPGP security')
    expect(security).toHaveTextContent('Verified OpenPGP signature')
    expect(security).toHaveTextContent('PGP encrypted')
  })
})
