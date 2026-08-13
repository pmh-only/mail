import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

process.env.BODY_SIZE_LIMIT ||= 'Infinity'
const { handler } = await import('./build/handler.js')

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 3000)
const websocketPath = '/api/external/v1/mcp/ws'
const rostackWebsocketPath = '/api/rostack/v1/events'
const mcpHttpUrl = `http://127.0.0.1:${port}/api/external/v1/mcp`
const authCheckUrl = `http://127.0.0.1:${port}/api/external/v1/auth-check`
const rostackSessionUrl = `http://127.0.0.1:${port}/api/rostack/v1/session`
const rostackReplayUrl = `http://127.0.0.1:${port}/api/rostack/v1/events/replay`

const server = createServer(handler)
const sockets = new Set()
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024 * 1024,
  handleProtocols(protocols) {
    return protocols.has('mcp') ? 'mcp' : false
  }
})
const rostackWss = new WebSocketServer({
  noServer: true,
  maxPayload: 1024 * 1024,
  handleProtocols(protocols) {
    return protocols.has('rostack.v1') ? 'rostack.v1' : false
  }
})

function apiKeyFromUpgrade(request) {
  const authorization = request.headers.authorization ?? ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (bearer) return bearer
  return (request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith('pmail_'))
}

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
  )
  socket.destroy()
}

server.on('upgrade', async (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === rostackWebsocketPath) {
    if (
      !(request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((value) => value.trim())
        .includes('rostack.v1')
    ) {
      rejectUpgrade(socket, 400, 'rostack.v1 subprotocol required')
      return
    }
    rostackWss.handleUpgrade(request, socket, head, (websocket) => {
      rostackWss.emit('connection', websocket)
    })
    return
  }
  if (pathname !== websocketPath) {
    rejectUpgrade(socket, 404, 'Not Found')
    return
  }

  const apiKey = apiKeyFromUpgrade(request)
  if (!apiKey) {
    rejectUpgrade(socket, 401, 'Unauthorized')
    return
  }

  try {
    const response = await fetch(authCheckUrl, {
      headers: { authorization: `Bearer ${apiKey}` }
    })
    if (!response.ok) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
  } catch {
    rejectUpgrade(socket, 503, 'Service Unavailable')
    return
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit('connection', websocket, request, apiKey)
  })
})

const retryableRostackErrors = new Set([
  'authentication_failed',
  'rate_limited',
  'internal_error',
  'service_unavailable'
])

function rostackError(websocket, code, message, subscriptionId, retryAfterMs) {
  websocket.send(
    JSON.stringify({
      type: 'error',
      ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
      code,
      message,
      retryable: retryableRostackErrors.has(code),
      ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {})
    })
  )
}

function exactObject(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const names = Object.keys(value)
  return (
    names.every((name) => keys.includes(name)) && required.every((name) => names.includes(name))
  )
}

function validString(value) {
  return typeof value === 'string' && value.length > 0
}

function normalizedSubscription(message) {
  return JSON.stringify({
    resource: message.resource,
    event_types: [
      ...(message.event_types ?? [
        'mailbox-entry.created',
        'mailbox-entry.updated',
        'mailbox-entry.deleted'
      ])
    ].sort(),
    cursor: message.cursor ?? null,
    event_encoding: message.event_encoding ?? 'json'
  })
}

function sendRostackEvent(websocket, subscription, event) {
  if (!subscription.eventTypes.has(event.event_type)) return
  if (subscription.encoding === 'compact-json') {
    websocket.send(
      JSON.stringify([
        'e',
        subscription.id,
        event.event_id,
        event.cursor,
        Date.parse(event.occurred_at),
        event.event_type,
        event.resource_id,
        event.resource_version
      ])
    )
    return
  }
  websocket.send(JSON.stringify({ type: 'event', subscription_id: subscription.id, ...event }))
}

rostackWss.on('connection', (websocket) => {
  sockets.add(websocket)
  const subscriptions = new Map()
  let session = null
  let polling = false
  let lastInboundAt = Date.now()
  let heartbeat = null
  const peerPingIds = new Set()
  let commandQueue = Promise.resolve()
  const authenticationTimer = setTimeout(
    () => websocket.close(4408, 'Authentication timeout'),
    10000
  )

  async function authenticate(message) {
    if (!exactObject(message, ['type', 'method', 'token'])) {
      if (session) rostackError(websocket, 'invalid_message', 'Invalid authenticate message')
      else websocket.close(4400, 'Invalid authenticate message')
      return
    }
    if (
      !['shared_token'].includes(message.method) ||
      typeof message.token !== 'string' ||
      !message.token
    ) {
      if (session)
        rostackError(
          websocket,
          'authentication_failed',
          'Replacement credential is invalid',
          undefined
        )
      else websocket.close(4401, 'Authentication failed')
      return
    }
    let response
    try {
      response = await fetch(rostackSessionUrl, {
        headers: { authorization: `Rostack-Token ${message.token}` }
      })
    } catch {
      rostackError(
        websocket,
        'service_unavailable',
        'Authentication service is unavailable',
        undefined,
        1000
      )
      return
    }
    if (!response.ok) {
      if (response.status >= 500) {
        rostackError(
          websocket,
          'service_unavailable',
          'Authentication service is unavailable',
          undefined,
          1000
        )
        return
      }
      if (session)
        rostackError(
          websocket,
          'authentication_failed',
          'Replacement credential is invalid',
          undefined
        )
      else websocket.close(4401, 'Authentication failed')
      return
    }
    const nextSession = await response.json()
    if (session && session.principalId !== nextSession.principal_id) {
      rostackError(
        websocket,
        'reauthentication_identity_mismatch',
        'Reauthentication must use the same principal'
      )
      return
    }
    session = { token: message.token, principalId: nextSession.principal_id }
    clearTimeout(authenticationTimer)
    websocket.send(
      JSON.stringify({
        type: 'authenticated',
        method: 'shared_token',
        protocol_version: 'rostack_v1',
        api_version: nextSession.api_version,
        principal_id: nextSession.principal_id
      })
    )
  }

  async function replay(subscription, cursor) {
    let nextCursor = cursor
    while (websocket.readyState === websocket.OPEN) {
      let response
      try {
        response = await fetch(`${rostackReplayUrl}?cursor=${encodeURIComponent(nextCursor)}`, {
          headers: { authorization: `Rostack-Token ${session.token}` }
        })
      } catch {
        rostackError(
          websocket,
          'service_unavailable',
          'Event service is unavailable',
          subscription.id,
          1000
        )
        return false
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          websocket.close(
            response.status === 403 ? 4403 : 4401,
            'Credential is no longer authorized'
          )
          return false
        }
        const error = await response.json().catch(() => ({}))
        const code = ['cursor_scope_mismatch', 'cursor_unavailable'].includes(error.code)
          ? error.code
          : response.status >= 500
            ? 'service_unavailable'
            : 'internal_error'
        rostackError(
          websocket,
          code,
          error.message ?? 'Event replay failed',
          subscription.id,
          code === 'service_unavailable' ? 1000 : undefined
        )
        return false
      }
      const body = await response.json()
      for (const event of body.events) {
        sendRostackEvent(websocket, subscription, event)
        nextCursor = event.cursor
      }
      subscription.cursor = nextCursor
      if (body.events.length < 100) return true
    }
    return false
  }

  async function poll() {
    if (polling || !session) return
    polling = true
    try {
      for (const subscription of subscriptions.values()) {
        if (!subscription.replaying) await replay(subscription, subscription.cursor)
      }
    } catch {
      rostackError(websocket, 'internal_error', 'Unexpected subscription failure')
    } finally {
      polling = false
    }
  }
  const pollTimer = setInterval(() => void poll(), 1000)
  const heartbeatTimer = setInterval(() => {
    if (!session || websocket.readyState !== websocket.OPEN) return
    if (heartbeat && Date.now() >= heartbeat.deadline) {
      websocket.close(4408, 'Heartbeat timeout')
      return
    }
    if (!heartbeat && Date.now() - lastInboundAt >= 30000) {
      heartbeat = { id: randomUUID(), deadline: Date.now() + 10000 }
      websocket.send(JSON.stringify({ type: 'ping', id: heartbeat.id }))
    }
  }, 1000)

  websocket.on('close', () => {
    clearTimeout(authenticationTimer)
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
    sockets.delete(websocket)
  })
  async function handleRostackMessage(data, isBinary) {
    if (isBinary) {
      websocket.close(4400, 'JSON messages required')
      return
    }
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      if (session) rostackError(websocket, 'invalid_message', 'Invalid JSON message')
      else websocket.close(4400, 'Invalid JSON message')
      return
    }
    try {
      if (!session && message.type !== 'authenticate') {
        websocket.close(4401, 'Authentication required')
        return
      }
      if (message.type === 'authenticate') {
        await authenticate(message)
        return
      }
      if (message.type === 'ping') {
        if (
          !exactObject(message, ['type', 'id']) ||
          !validString(message.id) ||
          peerPingIds.has(message.id)
        ) {
          rostackError(websocket, 'invalid_message', 'Invalid ping message')
          return
        }
        peerPingIds.add(message.id)
        lastInboundAt = Date.now()
        websocket.send(JSON.stringify({ type: 'pong', id: message.id }))
        return
      }
      if (message.type === 'pong') {
        if (!exactObject(message, ['type', 'id']) || !validString(message.id)) {
          rostackError(websocket, 'invalid_message', 'Invalid pong message')
          return
        }
        if (heartbeat?.id === message.id) heartbeat = null
        lastInboundAt = Date.now()
        return
      }
      if (message.type === 'unsubscribe') {
        if (
          !exactObject(message, ['type', 'subscription_id']) ||
          !validString(message.subscription_id)
        ) {
          rostackError(websocket, 'invalid_message', 'Invalid unsubscribe message')
          return
        }
        subscriptions.delete(message.subscription_id)
        lastInboundAt = Date.now()
        return
      }
      if (
        message.type !== 'subscribe' ||
        !exactObject(
          message,
          [
            'type',
            'subscription_id',
            'resource',
            'event_types',
            'filter',
            'cursor',
            'event_encoding'
          ],
          ['type', 'subscription_id', 'resource']
        ) ||
        !validString(message.subscription_id) ||
        !validString(message.resource)
      ) {
        rostackError(websocket, 'invalid_message', 'Invalid subscribe message')
        return
      }
      if (message.resource !== 'mailbox-entries') {
        rostackError(
          websocket,
          'resource_not_found',
          'Resource is not available',
          message.subscription_id
        )
        return
      }
      if (message.filter !== undefined) {
        rostackError(
          websocket,
          'unsupported_filter',
          'Event filtering is not supported',
          message.subscription_id
        )
        return
      }
      const allowedEvents = new Set([
        'mailbox-entry.created',
        'mailbox-entry.updated',
        'mailbox-entry.deleted'
      ])
      if (
        message.event_types !== undefined &&
        (!Array.isArray(message.event_types) ||
          message.event_types.length === 0 ||
          message.event_types.some((value) => !validString(value)) ||
          new Set(message.event_types).size !== message.event_types.length)
      ) {
        rostackError(
          websocket,
          'invalid_message',
          'Invalid event type list',
          message.subscription_id
        )
        return
      }
      const eventTypes = new Set(message.event_types ?? allowedEvents)
      if ([...eventTypes].some((value) => !allowedEvents.has(value))) {
        rostackError(
          websocket,
          'unsupported_event_type',
          'Event type is not supported',
          message.subscription_id
        )
        return
      }
      if (!['json', 'compact-json'].includes(message.event_encoding ?? 'json')) {
        rostackError(
          websocket,
          'unsupported_encoding',
          'Encoding is not supported',
          message.subscription_id
        )
        return
      }
      if (message.cursor !== undefined && !validString(message.cursor)) {
        rostackError(websocket, 'invalid_message', 'Invalid cursor', message.subscription_id)
        return
      }
      const definition = normalizedSubscription(message)
      lastInboundAt = Date.now()
      const current = subscriptions.get(message.subscription_id)
      if (current) {
        if (current.definition !== definition) {
          rostackError(
            websocket,
            'subscription_id_conflict',
            'Subscription ID is already active',
            message.subscription_id
          )
          return
        }
        websocket.send(
          JSON.stringify({
            type: 'subscribed',
            subscription_id: current.id,
            event_encoding: current.encoding,
            replaying: current.replaying
          })
        )
        return
      }
      let cursor = message.cursor
      if (!cursor) {
        let response
        try {
          response = await fetch(rostackReplayUrl, {
            headers: { authorization: `Rostack-Token ${session.token}` }
          })
        } catch {
          rostackError(
            websocket,
            'service_unavailable',
            'Event service is unavailable',
            message.subscription_id,
            1000
          )
          return
        }
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            websocket.close(
              response.status === 403 ? 4403 : 4401,
              'Credential is no longer authorized'
            )
          } else {
            rostackError(
              websocket,
              'service_unavailable',
              'Event service is unavailable',
              message.subscription_id,
              1000
            )
          }
          return
        }
        cursor = (await response.json()).cursor
      }
      const subscription = {
        id: message.subscription_id,
        definition,
        eventTypes,
        encoding: message.event_encoding ?? 'json',
        cursor,
        replaying: Boolean(message.cursor)
      }
      subscriptions.set(subscription.id, subscription)
      websocket.send(
        JSON.stringify({
          type: 'subscribed',
          subscription_id: subscription.id,
          event_encoding: subscription.encoding,
          replaying: subscription.replaying
        })
      )
      if (subscription.replaying) {
        const complete = await replay(subscription, subscription.cursor)
        if (complete) {
          websocket.send(
            JSON.stringify({ type: 'replay_complete', subscription_id: subscription.id })
          )
          subscription.replaying = false
        } else subscriptions.delete(subscription.id)
      }
    } catch {
      if (session) rostackError(websocket, 'internal_error', 'Unexpected gateway failure')
      else websocket.close(4500, 'Unexpected gateway failure')
    }
  }

  websocket.on('message', (data, isBinary) => {
    commandQueue = commandQueue.then(() => handleRostackMessage(data, isBinary))
  })
})

wss.on('connection', (websocket, _request, apiKey) => {
  sockets.add(websocket)
  websocket.on('close', () => sockets.delete(websocket))
  websocket.on('message', async (data, isBinary) => {
    if (isBinary) {
      websocket.close(1003, 'JSON messages required')
      return
    }
    try {
      const request = JSON.parse(data.toString())
      const response = await fetch(mcpHttpUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: data.toString()
      })
      if (response.status === 202) return
      if (response.status === 401 || response.status === 403) {
        websocket.close(1008, 'API key is no longer authorized')
        return
      }
      if (!response.ok) {
        websocket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request?.id ?? null,
            error: {
              code: response.status === 429 ? -32029 : -32000,
              message: response.status === 429 ? 'Rate limit exceeded' : 'MCP request failed'
            }
          })
        )
        return
      }
      websocket.send(await response.text())
    } catch {
      websocket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal error' }
        })
      )
    }
  })
})

server.listen(port, host, () => {
  console.log(`[web] listening on ${host}:${port}`)
})

function shutdown() {
  let rostackDrain = false
  for (const socket of sockets) {
    if (socket.protocol === 'rostack.v1') {
      rostackDrain = true
      socket.send(
        JSON.stringify({
          type: 'go_away',
          reason: 'server_shutdown',
          reconnect_after_ms: 1000,
          drain_timeout_ms: 30000
        })
      )
      setTimeout(() => socket.close(4410, 'Server shutting down'), 30000).unref()
    } else socket.close(1001, 'Server shutting down')
  }
  if (rostackDrain) {
    setTimeout(() => server.close(() => process.exit(0)), 30000).unref()
  } else server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
