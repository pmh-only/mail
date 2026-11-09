const CACHE_NAME = 'mail-v4'
const READ_NOTIFICATION_CACHE = 'mail-read-notifications-v1'
const READ_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const READ_CONTROL_VERSION = 1
const MARK_READ_ACTION = 'mark-read'
let pushQueue = Promise.resolve()

function getNotificationUrl(notification) {
  const rawUrl = notification.data?.url || '/'
  return new URL(rawUrl, self.location.origin).href
}

async function openApp(url) {
  const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windowClients) {
    if (client.frameType !== 'top-level' && client.frameType !== 'auxiliary') continue
    if ('navigate' in client) {
      const navigatedClient = await client.navigate(url)
      if (navigatedClient && 'focus' in navigatedClient) return navigatedClient.focus()
      if ('focus' in client) return client.focus()
      return undefined
    }
  }
  return clients.openWindow(url)
}

async function markNotificationMessageRead(notification) {
  const messageId = notification.data?.messageId
  if (!Number.isInteger(messageId) || messageId <= 0) return false

  const response = await fetch('/api/messages/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [messageId], action: 'mark_read' })
  })

  return response.ok
}

function readNotificationMarker(messageId) {
  return `${self.location.origin}/.service-worker/read-notification/${messageId}`
}

async function rememberReadNotifications(ids) {
  const cache = await caches.open(READ_NOTIFICATION_CACHE)
  await Promise.all(
    [...ids].map((id) =>
      cache.put(
        readNotificationMarker(id),
        new Response(null, {
          headers: { 'x-expires-at': String(Date.now() + READ_NOTIFICATION_TTL_MS) }
        })
      )
    )
  )
  const markers = await cache.keys()
  await Promise.all(
    markers.map(async (key) => {
      const marker = await cache.match(key)
      const expiresAt = Number(marker?.headers.get('x-expires-at') || 0)
      if (expiresAt <= Date.now()) await cache.delete(key)
    })
  )
}

async function wasNotificationRead(messageId) {
  const cache = await caches.open(READ_NOTIFICATION_CACHE)
  const key = readNotificationMarker(messageId)
  const marker = await cache.match(key)
  if (!marker) return false
  const expiresAt = Number(marker.headers.get('x-expires-at') || 0)
  if (expiresAt > Date.now()) return true
  await cache.delete(key)
  return false
}

async function closeReadNotifications(messageIds) {
  const ids = new Set(
    Array.isArray(messageIds)
      ? messageIds.filter((id) => Number.isInteger(id) && id > 0)
      : []
  )
  if (ids.size === 0) return

  await rememberReadNotifications(ids).catch(() => {})
  const notifications = await self.registration.getNotifications()
  for (const notification of notifications) {
    if (ids.has(notification.data?.messageId)) notification.close()
  }
}

async function handlePush(data) {
  if (data.type === 'messages-read') {
    await closeReadNotifications(data.messageIds)
    return
  }

  const count = typeof data.unreadCount === 'number' ? data.unreadCount : undefined
  const messageId = Number.isInteger(data.messageId) && data.messageId > 0 ? data.messageId : undefined
  if (messageId && (await wasNotificationRead(messageId))) return
  const actions = messageId ? [{ action: MARK_READ_ACTION, title: 'Mark read' }] : []
  await Promise.all([
    self.registration.showNotification(data.title || 'New mail', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge.png',
      tag: data.tag || 'mail',
      renotify: true,
      data: { url: data.url || '/', messageId },
      actions
    }),
    count !== undefined ? navigator.setAppBadge(count).catch(() => {}) : Promise.resolve()
  ])
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== READ_NOTIFICATION_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'New mail', body: event.data.text() }
  }
  const task = pushQueue.then(() => handlePush(data))
  pushQueue = task.catch(() => {})
  event.waitUntil(task)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = getNotificationUrl(event.notification)

  if (event.action === MARK_READ_ACTION) {
    event.waitUntil(
      markNotificationMessageRead(event.notification)
        .catch(() => false)
        .then((ok) => (ok ? undefined : openApp(url)))
    )
    return
  }

  event.waitUntil(openApp(url))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_PUSH_CAPABILITIES') {
    event.ports[0]?.postMessage({ readControlVersion: READ_CONTROL_VERSION })
    return
  }
  if (event.data?.type !== 'CLEAR_OFFLINE_CACHE') return
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== READ_NOTIFICATION_CACHE).map((key) => caches.delete(key)))
      )
  )
})
