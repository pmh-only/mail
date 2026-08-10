// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { tick } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { editorState, notifyMailboxStateChanged, page, toast } = vi.hoisted(() => ({
  editorState: {
    html: '<p>Initial body</p>',
    text: 'Initial body',
    href: 'https://existing.example',
    calls: [] as string[]
  },
  notifyMailboxStateChanged: vi.fn(),
  page: { data: { hasOpenAiKey: true } },
  toast: vi.fn()
}))

vi.mock('$app/state', () => ({ page }))
vi.mock('$lib/mailbox-state', () => ({ notifyMailboxStateChanged }))
vi.mock('svelte-sonner', () => ({ toast }))
vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({ name: 'starter-kit' }) }
}))
vi.mock('@tiptap/extension-text-align', () => ({
  default: { configure: () => ({ name: 'text-align' }) }
}))
vi.mock('@tiptap/core', () => ({
  Editor: class {
    commands = {
      setContent: (value: string) => {
        editorState.html = value
        editorState.calls.push(`setContent:${value}`)
      },
      focus: (position?: string) => editorState.calls.push(`focus:${position ?? ''}`)
    }

    constructor(_options: unknown) {}

    chain() {
      let proxy: Record<string, unknown>
      proxy = new Proxy(
        {},
        {
          get:
            (_target, property) =>
            (...args: unknown[]) => {
              editorState.calls.push(`${String(property)}:${JSON.stringify(args)}`)
              return property === 'run' ? true : proxy
            }
        }
      )
      return proxy
    }

    getHTML() {
      return editorState.html
    }

    getText() {
      return editorState.text
    }

    getAttributes() {
      return { href: editorState.href }
    }

    isActive() {
      return false
    }
  }
}))

import { composer } from '$lib/composer.svelte'
import Composer from './Composer.svelte'

function resetComposer(overrides: Record<string, unknown> = {}) {
  Object.assign(composer, {
    open: true,
    minimized: false,
    fullscreen: false,
    mode: 'compose',
    to: 'alice@example.com',
    cc: '',
    bcc: '',
    subject: 'Hello',
    initialHtml: '<p>Initial body</p>',
    attachments: [],
    inReplyTo: null,
    draftId: null,
    lastSavedAt: 0,
    signatureProfiles: [],
    selectedSignatureId: null,
    currentSignatureHtml: '',
    smtpServers: [],
    selectedSmtpServerId: '',
    fromName: '',
    openPgpSigning: 'none',
    openPgpEncrypt: false,
    attachPublicKey: false,
    openPgpAvailable: false,
    ...overrides
  })
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === '/api/message-templates') return Promise.resolve(Response.json({ templates: [] }))
  if (url === '/api/settings') return Promise.resolve(Response.json({ smtpServers: [] }))
  if (url === '/api/openpgp/keys') return Promise.resolve(Response.json({ keys: [] }))
  if (url === '/api/drafts' && init?.method === 'POST')
    return Promise.resolve(Response.json({ id: 9 }))
  return Promise.resolve(new Response(null))
}

describe('Composer', () => {
  beforeEach(() => {
    resetComposer()
    editorState.html = '<p>Initial body</p>'
    editorState.text = 'Initial body'
    editorState.href = 'https://existing.example'
    editorState.calls = []
    page.data.hasOpenAiKey = true
    notifyMailboxStateChanged.mockReset()
    toast.mockReset()
    vi.stubGlobal('fetch', vi.fn(defaultFetch))
    vi.stubGlobal('confirm', vi.fn())
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn().mockReturnValue(true)
    })
  })

  it.each([
    ['compose', 'New Message'],
    ['reply', 'Reply'],
    ['reply-all', 'Reply'],
    ['forward', 'Forward']
  ])('renders the %s title', async (mode, title) => {
    resetComposer({ mode })
    render(Composer)
    expect(screen.getByRole('dialog', { name: title })).toBeVisible()
    await waitFor(() =>
      expect(editorState.calls.some((call) => call.startsWith('setContent:'))).toBe(true)
    )
  })

  it('keeps the mounted composer hidden while closed', () => {
    resetComposer({ open: false })
    render(Composer)
    expect(screen.getByRole('dialog', { hidden: true })).not.toBeVisible()
  })

  it('renders fields and enables send for valid recipients', async () => {
    render(Composer)
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveAttribute(
      'placeholder',
      'recipients@example.com'
    )
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('toggles minimized and fullscreen layouts', async () => {
    const user = userEvent.setup()
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(composer.minimized).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Subject' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(composer.minimized).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    expect(composer.fullscreen).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Exit fullscreen' }))
    expect(composer.fullscreen).toBe(false)
  })

  it('switches to advanced fields and reveals Cc and Bcc', async () => {
    const user = userEvent.setup()
    resetComposer({
      smtpServers: [{ id: 'primary', name: 'Primary', from: 'Alice <alice@example.com>' }],
      selectedSmtpServerId: 'primary'
    })
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByRole('textbox', { name: 'From display name' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'SMTP server' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cc' }))
    await user.click(screen.getByRole('button', { name: 'Bcc' }))
    expect(screen.getByRole('combobox', { name: 'Cc' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bcc' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configure a key for this sender' })).toHaveAttribute(
      'href',
      '/settings/openpgp'
    )
  })

  it('dispatches rich-text toolbar commands', async () => {
    const user = userEvent.setup()
    render(Composer)
    const actions = [
      'Undo',
      'Redo',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Bullet list',
      'Ordered list',
      'Blockquote',
      'Code block',
      'Horizontal rule',
      'Align left',
      'Align center',
      'Align right',
      'Justify'
    ]
    for (const action of actions) await user.click(screen.getByRole('button', { name: action }))
    expect(editorState.calls).toEqual(
      expect.arrayContaining(['toggleBold:[]', 'setTextAlign:["justify"]'])
    )
  })

  it('switches between rich text and Markdown', async () => {
    const user = userEvent.setup()
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Switch to markdown mode' }))
    const markdown = screen.getByRole('textbox', { name: 'Markdown message body' })
    expect(markdown).toHaveValue('Initial body')
    await user.clear(markdown)
    await user.type(markdown, '**Bold**')
    await user.click(screen.getByRole('button', { name: 'Switch to rich text mode' }))
    expect(screen.queryByRole('textbox', { name: 'Markdown message body' })).not.toBeInTheDocument()
    expect(editorState.calls.some((call) => call.includes('<strong>Bold</strong>'))).toBe(true)
  })

  it('applies and removes editor links', async () => {
    const user = userEvent.setup()
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Link' }))
    const field = screen.getByPlaceholderText('https://example.com')
    expect(field).toHaveValue('https://existing.example')
    await user.clear(field)
    await user.type(field, 'https://new.example{Enter}')
    expect(editorState.calls.some((call) => call.includes('setLink'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Link' }))
    await user.clear(screen.getByPlaceholderText('https://example.com'))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(editorState.calls.some((call) => call.startsWith('unsetLink:'))).toBe(true)
  })

  it('loads and inserts a message template', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input) === '/api/message-templates') {
        return Promise.resolve(
          Response.json({
            templates: [
              {
                id: 1,
                name: 'Greeting',
                subject: 'Template subject',
                html: '<p>Hello</p>',
                isSnippet: false
              }
            ]
          })
        )
      }
      return defaultFetch(input, init)
    })
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Advanced' }))
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    await user.click(await screen.findByRole('button', { name: /Greeting/ }))
    expect(editorState.calls.some((call) => call.includes('insertContent'))).toBe(true)
  })

  it('sends a valid message and closes the composer', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input) === '/api/send') return Promise.resolve(Response.json({ jobId: 4 }))
      return defaultFetch(input, init)
    })
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(composer.open).toBe(false))
    expect(fetch).toHaveBeenCalledWith(
      '/api/send',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    )
    expect(notifyMailboxStateChanged).toHaveBeenCalledWith('message-scheduled')
  })

  it('shows a server send failure in the error dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input) === '/api/send') {
        return Promise.resolve(Response.json({ error: 'SMTP unavailable' }, { status: 500 }))
      }
      return defaultFetch(input, init)
    })
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('dialog', { name: 'Composer error' })).toHaveTextContent(
      'SMTP unavailable'
    )
  })

  it('opens and cancels the discard confirmation', async () => {
    const user = userEvent.setup()
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Save this draft?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Save this draft?')).not.toBeInTheDocument()
    expect(composer.open).toBe(true)
  })

  it('offers attachment delivery modes', async () => {
    const user = userEvent.setup()
    render(Composer)
    await user.click(screen.getByRole('button', { name: 'Attach' }))
    expect(screen.getByRole('menu', { name: 'Attachment delivery mode' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Mail attachment/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Public link/ })).toBeInTheDocument()
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: 'Attachment delivery mode' })).not.toBeInTheDocument()
  })

  it('cleans up before-unload handling on destroy', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(Composer)
    await tick()
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
