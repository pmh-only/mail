// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { page } = vi.hoisted(() => ({ page: { data: { hasOpenAiKey: true } } }))
vi.mock('$app/state', () => ({ page }))

import AttachmentSummary from './AttachmentSummary.svelte'

const attachment = { id: 7, filename: 'notes.txt', contentType: 'text/plain' }

describe('AttachmentSummary', () => {
  beforeEach(() => {
    page.data.hasOpenAiKey = true
    vi.stubGlobal('fetch', vi.fn())
  })

  it.each([
    ['text/plain; charset=utf-8', 'file.bin'],
    ['application/json', 'file.bin'],
    ['application/ld+json', 'file.bin'],
    ['application/xml', 'file.bin'],
    ['application/yaml', 'file.bin'],
    ['application/x-yaml', 'file.bin'],
    ['application/octet-stream', 'FILE.CSV'],
    ['application/octet-stream', 'calendar.ics'],
    ['application/octet-stream', 'data.json'],
    ['application/octet-stream', 'events.log'],
    ['application/octet-stream', 'readme.md'],
    ['application/octet-stream', 'readme.markdown'],
    ['application/octet-stream', 'notes.txt'],
    ['application/octet-stream', 'table.tsv'],
    ['application/octet-stream', 'feed.xml'],
    ['application/octet-stream', 'config.yaml'],
    ['application/octet-stream', 'config.yml']
  ])('supports %s attachment %s', (contentType, filename) => {
    render(AttachmentSummary, { attachment: { ...attachment, contentType, filename } })
    expect(screen.getByRole('button', { name: 'Summarize attachment' })).toBeInTheDocument()
  })

  it('hides unsupported attachments and hides all actions without an AI key', () => {
    const { unmount } = render(AttachmentSummary, {
      attachment: { ...attachment, filename: 'photo.png', contentType: 'image/png' }
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    unmount()

    page.data.hasOpenAiKey = false
    render(AttachmentSummary, { attachment })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders compact and icon-only layouts', () => {
    const { unmount } = render(AttachmentSummary, { attachment, compact: true })
    expect(screen.getByRole('button')).toHaveTextContent('Summarize')
    expect(screen.getByRole('button').parentElement).toHaveClass('mt-2')
    unmount()

    render(AttachmentSummary, { attachment, iconOnly: true })
    expect(screen.getByRole('button')).toHaveAccessibleName('Summarize attachment')
    expect(screen.getByRole('button')).not.toHaveTextContent('Summarize')
    expect(screen.getByRole('button').parentElement).toHaveClass('contents')
  })

  it('shows loading while the request is pending', async () => {
    const user = userEvent.setup()
    let resolveResponse!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    )
    render(AttachmentSummary, { attachment })

    await user.click(screen.getByRole('button', { name: 'Summarize attachment' }))
    expect(screen.getByRole('button', { name: 'Summarizing attachment' })).toBeDisabled()
    expect(screen.getByText('Summarizing...')).toBeInTheDocument()

    resolveResponse(Response.json({ summary: 'Result', cached: false }))
    expect(await screen.findByText('Result')).toBeInTheDocument()
  })

  it('renders and refreshes a cached summary', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ summary: 'Cached summary', cached: true }))
      .mockResolvedValueOnce(Response.json({ summary: 'Fresh summary', cached: false }))
    render(AttachmentSummary, { attachment })

    await user.click(screen.getByRole('button', { name: 'Summarize attachment' }))
    expect(await screen.findByText('Cached summary')).toBeInTheDocument()
    expect(screen.getByText('Cached result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh summary' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh summary' }))
    expect(await screen.findByText('Fresh summary')).toBeInTheDocument()
    expect(screen.queryByText('Cached result')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/ai/attachments/7/summary', { method: 'POST' })
  })

  it('renders an API error', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Summary denied' }), { status: 403 })
    )
    render(AttachmentSummary, { attachment })
    await user.click(screen.getByRole('button'))
    expect(await screen.findByText('Summary denied')).toBeInTheDocument()
  })

  it.each([
    [new Error('Network unavailable'), 'Network unavailable'],
    ['unknown rejection', 'Failed to summarize attachment.']
  ])('renders request failures', async (reason, message) => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(reason)
    render(AttachmentSummary, { attachment, iconOnly: true })
    await user.click(screen.getByRole('button'))
    expect(await screen.findByText(message)).toHaveClass('basis-full')
  })
})
