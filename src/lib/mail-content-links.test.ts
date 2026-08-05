import assert from 'node:assert/strict'
import { test } from 'vitest'
import { interceptMailContentLinks, resolveMailContentUrl } from './mail-content-links.ts'

test('resolves absolute and relative mail content links', () => {
  assert.equal(
    resolveMailContentUrl(
      'https://example.com/account?tab=security',
      'https://mail.example/inbox/1'
    ),
    'https://example.com/account?tab=security'
  )
  assert.equal(
    resolveMailContentUrl('../unsubscribe', 'https://news.example/messages/welcome'),
    'https://news.example/unsubscribe'
  )
})

test('allows links handled by external applications', () => {
  assert.equal(
    resolveMailContentUrl('mailto:support@example.com', 'https://mail.example/inbox/1'),
    'mailto:support@example.com'
  )
  assert.equal(
    resolveMailContentUrl('tel:+15550100', 'https://mail.example/inbox/1'),
    'tel:+15550100'
  )
})

test('rejects fragments, unsafe protocols, and invalid URLs', () => {
  assert.equal(resolveMailContentUrl(undefined, 'https://mail.example/inbox/1'), null)
  assert.equal(resolveMailContentUrl('   ', 'https://mail.example/inbox/1'), null)
  assert.equal(resolveMailContentUrl('#details', 'https://mail.example/inbox/1'), null)
  assert.equal(resolveMailContentUrl('javascript:alert(1)', 'https://mail.example/inbox/1'), null)
  assert.equal(resolveMailContentUrl('data:text/html,unsafe', 'https://mail.example/inbox/1'), null)
  assert.equal(resolveMailContentUrl('https://[invalid', 'https://mail.example/inbox/1'), null)
})

test('intercepts valid links and passes their resolved URL to the warning screen', () => {
  let clickHandler: ((event: MouseEvent) => void) | undefined
  let prevented = false
  let stopped = false
  let interceptedUrl: string | null = null
  const anchor = {
    getAttribute: () => '../account',
    ownerDocument: { baseURI: 'https://example.com/mail/welcome' }
  }
  const doc = {
    addEventListener: (_type: string, handler: (event: MouseEvent) => void) => {
      clickHandler = handler
    }
  }

  interceptMailContentLinks(doc as unknown as Document, (url) => (interceptedUrl = url))
  clickHandler?.({
    target: { closest: () => anchor },
    preventDefault: () => (prevented = true),
    stopPropagation: () => (stopped = true)
  } as unknown as MouseEvent)

  assert.equal(interceptedUrl, 'https://example.com/account')
  assert.equal(prevented, true)
  assert.equal(stopped, true)
})

test('blocks unsafe mail content links without opening the warning screen', () => {
  let clickHandler: ((event: MouseEvent) => void) | undefined
  let prevented = false
  let interceptedUrl: string | null = null
  const anchor = {
    getAttribute: () => 'javascript:alert(1)',
    ownerDocument: { baseURI: 'https://mail.example/inbox/1' }
  }
  const doc = {
    addEventListener: (_type: string, handler: (event: MouseEvent) => void) => {
      clickHandler = handler
    }
  }

  interceptMailContentLinks(doc as unknown as Document, (url) => (interceptedUrl = url))
  clickHandler?.({
    target: { closest: () => anchor },
    preventDefault: () => (prevented = true),
    stopPropagation: () => {}
  } as unknown as MouseEvent)

  assert.equal(interceptedUrl, null)
  assert.equal(prevented, true)
})

test('ignores non-links, fragments, and resolves links from a target parent', () => {
  let clickHandler: ((event: MouseEvent) => void) | undefined
  let calls = 0
  let prevented = false
  const doc = {
    addEventListener: (_type: string, handler: (event: MouseEvent) => void) => {
      clickHandler = handler
    }
  }
  interceptMailContentLinks(doc as unknown as Document, () => calls++)

  clickHandler?.({ target: null } as unknown as MouseEvent)
  clickHandler?.({ target: 'text' } as unknown as MouseEvent)
  clickHandler?.({ target: {} } as unknown as MouseEvent)
  clickHandler?.({
    target: { parentElement: { closest: () => ({ getAttribute: () => '#section' }) } },
    preventDefault: () => (prevented = true)
  } as unknown as MouseEvent)
  clickHandler?.({
    target: {
      closest: () => null,
      parentElement: {
        closest: () => ({
          getAttribute: () => '/help',
          ownerDocument: { baseURI: 'https://mail.example/inbox/1' }
        })
      }
    },
    preventDefault: () => (prevented = true),
    stopPropagation: () => {}
  } as unknown as MouseEvent)

  assert.equal(calls, 1)
  assert.equal(prevented, true)
})
