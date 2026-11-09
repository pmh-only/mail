import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import vm from 'node:vm'

type PushEvent = {
  data: { json: () => unknown; text: () => string }
  waitUntil: (value: Promise<unknown>) => void
}

type WorkerMessageEvent = {
  data: { type: string }
  ports: Array<{ postMessage: (value: unknown) => void }>
}

type NotificationClickEvent = {
  action: string
  notification: { data: { url: string; messageId: number }; close: () => void }
  waitUntil: (value: Promise<unknown>) => void
}

test.each([
  ['', 'top-level'],
  ['mark-read', 'top-level'],
  ['', 'auxiliary'],
  ['mark-read', 'auxiliary']
])(
  'notification action %j navigates the %s app instead of a recently focused message iframe',
  async (action, frameType) => {
    const navigated: string[] = []
    const focused: string[] = []
    const opened: string[] = []
    const closed: string[] = []
    const listeners = new Map<string, (event: NotificationClickEvent) => void>()
    const makeClient = (name: string, frameType: string) => ({
      frameType,
      navigate: async (url: string) => {
        navigated.push(`${name}:${url}`)
        return { focus: async () => focused.push(name) }
      },
      focus: async () => focused.push(name)
    })
    const iframe = makeClient('message', 'nested')
    const app = makeClient('app', frameType)
    let windowClients = [iframe, app]
    const source = readFileSync(new URL('../../static/sw.js', import.meta.url), 'utf8')
    vm.runInNewContext(source, {
      self: {
        location: { origin: 'https://mail.example' },
        addEventListener: (type: string, handler: (event: NotificationClickEvent) => void) =>
          listeners.set(type, handler)
      },
      clients: {
        matchAll: async (options: { type: string; includeUncontrolled: boolean }) => {
          assert.equal(options.type, 'window')
          assert.equal(options.includeUncontrolled, true)
          return windowClients
        },
        openWindow: async (url: string) => opened.push(url)
      },
      fetch: async () => ({ ok: false }),
      URL
    })
    const handleClick = listeners.get('notificationclick')
    assert.ok(handleClick)
    const completions: Promise<unknown>[] = []
    const click = () => {
      handleClick({
        action,
        notification: {
          data: { url: '/inbox/42', messageId: 42 },
          close: () => closed.push('notification')
        },
        waitUntil: (value) => completions.push(value)
      })
      return completions.at(-1)
    }

    await click()
    assert.deepEqual(navigated, ['app:https://mail.example/inbox/42'])
    assert.deepEqual(focused, ['app'])
    assert.deepEqual(opened, [])

    // An embedded client alone must not prevent opening a real app window.
    windowClients = [iframe]
    await click()
    assert.deepEqual(navigated, ['app:https://mail.example/inbox/42'])
    assert.deepEqual(focused, ['app'])
    assert.deepEqual(opened, ['https://mail.example/inbox/42'])

    windowClients = []
    await click()
    assert.equal(opened.length, 2)
    assert.equal(closed.length, 3)
  }
)

test('read control pushes close matching notifications without showing a new one', async () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const closed: number[] = []
  const shown: Array<{ title: string; options: { tag?: string } }> = []
  const markers = new Map<string, Response>()
  const notifications = [1, 2, 3].map((messageId) => ({
    data: { messageId },
    close: () => closed.push(messageId)
  }))
  const self = {
    location: { origin: 'https://mail.example' },
    registration: {
      getNotifications: async () => notifications,
      showNotification: async (title: string, options: { tag?: string }) => {
        shown.push({ title, options })
      }
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler)
    }
  }
  const cache = {
    put: async (key: string, response: Response) => markers.set(key, response),
    keys: async () => [...markers.keys()],
    delete: async (key: string) => markers.delete(key),
    match: async (key: string) => markers.get(key)
  }
  const caches = { open: async () => cache }
  const navigator = { setAppBadge: async () => {} }
  const source = readFileSync(new URL('../../static/sw.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    self,
    caches,
    navigator,
    Response,
    URL,
    Set,
    Array,
    Number,
    Promise
  })
  const handlePush = listeners.get('push') as ((event: PushEvent) => void) | undefined
  assert.ok(handlePush)

  let capabilities: unknown
  const handleMessage = listeners.get('message') as
    | ((event: WorkerMessageEvent) => void)
    | undefined
  assert.ok(handleMessage)
  handleMessage({
    data: { type: 'GET_PUSH_CAPABILITIES' },
    ports: [{ postMessage: (value) => (capabilities = value) }]
  })
  assert.equal((capabilities as { readControlVersion?: number })?.readControlVersion, 1)

  const completions: Promise<unknown>[] = []
  handlePush({
    data: {
      json: () => ({ type: 'messages-read', messageIds: [2, 99] }),
      text: () => ''
    },
    waitUntil: (value) => completions.push(value)
  })
  // Queue a stale notification concurrently; the read tombstone must be stored first.
  handlePush({
    data: { json: () => ({ title: 'Stale mail', messageId: 2 }), text: () => '' },
    waitUntil: (value) => completions.push(value)
  })
  await Promise.all(completions)
  assert.deepEqual(closed, [2])
  assert.equal(shown.length, 0)

  handlePush({
    data: { json: () => ({ title: 'New mail', messageId: 7 }), text: () => '' },
    waitUntil: (value) => completions.push(value)
  })
  await completions.at(-1)
  assert.equal(shown[0]?.options.tag, 'mail')
})
