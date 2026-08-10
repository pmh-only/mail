// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OpenPgpSettings from './OpenPgpSettings.svelte'

const ownKey = {
  id: 1,
  fingerprint: 'AAAA BBBB',
  name: 'Alice',
  email: 'alice@example.com',
  userIds: ['Alice <alice@example.com>'],
  isOwn: true,
  isDefault: false,
  hasPrivateKey: true,
  createdAt: '2026-08-10T00:00:00Z'
}

const publicKey = {
  ...ownKey,
  id: 2,
  fingerprint: 'CCCC DDDD',
  email: 'bob@example.com',
  userIds: [],
  isOwn: false,
  hasPrivateKey: false,
  isDefault: false
}

function keysResponse(keys: unknown[] = [ownKey]) {
  return Response.json({ keys })
}

describe('OpenPgpSettings', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(keysResponse())))

  it('loads keys and renders their capabilities', async () => {
    vi.mocked(fetch).mockResolvedValue(
      keysResponse([
        ownKey,
        publicKey,
        { ...publicKey, id: 3, email: '', userIds: [], isDefault: true }
      ])
    )
    render(OpenPgpSettings)

    expect(screen.getByText('Loading keys...')).toBeInTheDocument()
    expect(await screen.findByText('Alice <alice@example.com>')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText('OpenPGP key')).toBeInTheDocument()
    expect(screen.getByText('Private + public')).toBeInTheDocument()
    expect(screen.getAllByText('Public only')).toHaveLength(2)
    expect(screen.getByText('Default signing key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as primary signing key' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Download public key' })[0]).toHaveAttribute(
      'href',
      '/api/openpgp/keys/1/public'
    )
  })

  it('renders empty and missing-key payloads', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}))
    render(OpenPgpSettings)
    expect(await screen.findByText('No OpenPGP keys configured.')).toBeInTheDocument()
  })

  it.each([
    [new Response(JSON.stringify({ error: 'Keys locked' }), { status: 500 }), 'Keys locked'],
    ['reject', 'unknown']
  ])('reports key-loading failures', async (result, message) => {
    if (result instanceof Response) vi.mocked(fetch).mockResolvedValueOnce(result)
    else vi.mocked(fetch).mockRejectedValueOnce('unknown')
    render(OpenPgpSettings)
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('generates a key with selected settings and clears its passphrase', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([]))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(keysResponse([ownKey]))
    render(OpenPgpSettings)
    await screen.findByText('No OpenPGP keys configured.')
    const generate = screen.getByRole('button', { name: 'Generate key' })
    expect(generate).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'Alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.selectOptions(screen.getByLabelText('Algorithm'), 'rsa4096')
    await user.type(screen.getByLabelText('Key passphrase'), 'secret')
    await user.click(generate)

    expect(await screen.findByText('Alice <alice@example.com>')).toBeInTheDocument()
    expect(screen.getByLabelText('Key passphrase')).toHaveValue('')
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/openpgp/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate',
        name: 'Alice',
        email: 'alice@example.com',
        passphrase: 'secret',
        algorithm: 'rsa4096'
      })
    })
  })

  it('shows working state during key generation', async () => {
    let resolveSubmit!: (response: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([]))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSubmit = resolve
        })
      )
      .mockResolvedValueOnce(keysResponse([]))
    render(OpenPgpSettings)
    await screen.findByText('No OpenPGP keys configured.')
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Alice' } })
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Generate key' }))
    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled()
    resolveSubmit(new Response(null))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate key' })).toBeEnabled())
  })

  it('reports generation failure and retains the passphrase', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Generation failed' }), { status: 400 })
      )
    render(OpenPgpSettings)
    await screen.findByText('No OpenPGP keys configured.')
    await user.type(screen.getByLabelText('Name'), 'Alice')
    await user.type(screen.getByLabelText('Email'), 'a@example.com')
    await user.type(screen.getByLabelText('Key passphrase'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Generate key' }))
    expect(await screen.findByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByLabelText('Key passphrase')).toHaveValue('secret')
  })

  it('imports an uploaded key as a recipient public key', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([]))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(keysResponse([publicKey]))
    const { container } = render(OpenPgpSettings)
    await screen.findByText('No OpenPGP keys configured.')
    const file = new File(['PUBLIC KEY'], 'key.asc', { type: 'text/plain' })
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file)
    expect(screen.getByPlaceholderText('-----BEGIN PGP PRIVATE KEY BLOCK-----')).toHaveValue(
      'PUBLIC KEY'
    )
    await user.type(screen.getByLabelText('Passphrase (private keys only)'), 'unused')
    await user.click(screen.getByLabelText('This is my key'))
    await user.click(screen.getByRole('button', { name: 'Import key' }))

    expect(await screen.findByText('bob@example.com')).toBeInTheDocument()
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/openpgp/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'import',
        armoredKey: 'PUBLIC KEY',
        passphrase: 'unused',
        isOwn: false,
        makeDefault: false
      })
    })
    expect(screen.getByPlaceholderText('-----BEGIN PGP PRIVATE KEY BLOCK-----')).toHaveValue('')
    expect(screen.getByLabelText('Passphrase (private keys only)')).toHaveValue('')
  })

  it('does nothing when a file input change has no file', async () => {
    const { container } = render(OpenPgpSettings)
    await screen.findByText('Alice <alice@example.com>')
    const textarea = screen.getByPlaceholderText('-----BEGIN PGP PRIVATE KEY BLOCK-----')
    await fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement)
    expect(textarea).toHaveValue('')
  })

  it('reports import failure without clearing entered key material', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([]))
      .mockRejectedValueOnce(new Error('Import unavailable'))
    render(OpenPgpSettings)
    await screen.findByText('No OpenPGP keys configured.')
    const textarea = screen.getByPlaceholderText('-----BEGIN PGP PRIVATE KEY BLOCK-----')
    await fireEvent.input(textarea, { target: { value: 'ARMORED' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Import key' }))
    expect(await screen.findByText('Import unavailable')).toBeInTheDocument()
    expect(textarea).toHaveValue('ARMORED')
  })

  it('deletes a key and reloads the list', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse([ownKey]))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(keysResponse([]))
    render(OpenPgpSettings)
    const keyRow = (await screen.findByText('Alice <alice@example.com>')).closest('.flex-col')!
    await user.click(within(keyRow as HTMLElement).getByRole('button', { name: 'Delete key' }))
    expect(await screen.findByText('No OpenPGP keys configured.')).toBeInTheDocument()
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/openpgp/keys/1', { method: 'DELETE' })
  })

  it.each([
    [new Response(JSON.stringify({ error: 'Delete denied' }), { status: 403 }), 'Delete denied'],
    ['reject', 'unknown']
  ])('reports delete failures', async (result, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(keysResponse())
    if (result instanceof Response) vi.mocked(fetch).mockResolvedValueOnce(result)
    else vi.mocked(fetch).mockRejectedValueOnce('unknown')
    render(OpenPgpSettings)
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete key' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('marks an own private key as primary and reloads', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(keysResponse())
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(keysResponse([{ ...ownKey, isDefault: true }]))
    render(OpenPgpSettings)
    await user.click(await screen.findByRole('button', { name: 'Mark as primary signing key' }))
    expect(await screen.findByText('Default signing key')).toBeInTheDocument()
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/openpgp/keys/1', { method: 'PATCH' })
  })

  it.each([
    [
      new Response(JSON.stringify({ error: 'Cannot change primary' }), { status: 400 }),
      'Cannot change primary'
    ],
    ['reject', 'unknown']
  ])('reports primary-key failures', async (result, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(keysResponse())
    if (result instanceof Response) vi.mocked(fetch).mockResolvedValueOnce(result)
    else vi.mocked(fetch).mockRejectedValueOnce('unknown')
    render(OpenPgpSettings)
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Mark as primary signing key' })
    )
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
