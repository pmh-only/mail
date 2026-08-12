import { createServer } from 'node:http'
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

function rostackError(websocket, code, message, subscriptionId, retryable = false) {
  websocket.send(
    JSON.stringify({
      type: 'error',
      ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
      code,
      message,
      retryable
    })
  )
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
  const authenticationTimer = setTimeout(
    () => websocket.close(4408, 'Authentication timeout'),
    10000
  )

  async function authenticate(message) {
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
          undefined,
          true
        )
      else websocket.close(4401, 'Authentication failed')
      return
    }
    const response = await fetch(rostackSessionUrl, {
      headers: { authorization: `Rostack-Token ${message.token}` }
    })
    if (!response.ok) {
      if (session)
        rostackError(
          websocket,
          'authentication_failed',
          'Replacement credential is invalid',
          undefined,
          true
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
      const response = await fetch(`${rostackReplayUrl}?cursor=${encodeURIComponent(nextCursor)}`, {
        headers: { authorization: `Rostack-Token ${session.token}` }
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        rostackError(
          websocket,
          error.code ?? 'transient_error',
          error.message ?? 'Event replay failed',
          subscription.id,
          response.status >= 500
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
    } finally {
      polling = false
    }
  }
  const pollTimer = setInterval(() => void poll(), 1000)

  websocket.on('close', () => {
    clearTimeout(authenticationTimer)
    clearInterval(pollTimer)
    sockets.delete(websocket)
  })
  websocket.on('message', async (data, isBinary) => {
    if (isBinary) {
      websocket.close(4400, 'JSON messages required')
      return
    }
    try {
      const message = JSON.parse(data.toString())
      if (!session && message.type !== 'authenticate') {
        websocket.close(4401, 'Authentication required')
        return
      }
      if (message.type === 'authenticate') {
        await authenticate(message)
        return
      }
      if (message.type === 'ping') {
        if (typeof message.id !== 'string' || !message.id) {
          websocket.close(4400, 'Invalid protocol message')
          return
        }
        websocket.send(JSON.stringify({ type: 'pong', id: message.id }))
        return
      }
      if (message.type === 'pong') return
      if (message.type === 'unsubscribe') {
        subscriptions.delete(message.subscription_id)
        return
      }
      if (
        message.type !== 'subscribe' ||
        typeof message.subscription_id !== 'string' ||
        message.resource !== 'mailbox-entries' ||
        message.filter
      ) {
        websocket.close(4400, 'Invalid protocol message')
        return
      }
      const definition = normalizedSubscription(message)
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
      const allowedEvents = new Set([
        'mailbox-entry.created',
        'mailbox-entry.updated',
        'mailbox-entry.deleted'
      ])
      const eventTypes = new Set(message.event_types ?? allowedEvents)
      if (
        [...eventTypes].some((value) => !allowedEvents.has(value)) ||
        !['json', 'compact-json'].includes(message.event_encoding ?? 'json')
      ) {
        rostackError(
          websocket,
          'unsupported_subscription',
          'Unsupported event type or encoding',
          message.subscription_id
        )
        return
      }
      let cursor = message.cursor
      if (!cursor) {
        const response = await fetch(rostackReplayUrl, {
          headers: { authorization: `Rostack-Token ${session.token}` }
        })
        if (!response.ok) throw new Error('Unable to establish event cursor')
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
      websocket.close(4400, 'Invalid protocol message')
    }
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
  for (const socket of sockets) {
    if (socket.protocol === 'rostack.v1') {
      socket.send(
        JSON.stringify({
          type: 'go_away',
          reason: 'server_shutdown',
          reconnect_after_ms: 1000,
          drain_timeout_ms: 30000
        })
      )
      socket.close(4410, 'Server shutting down')
    } else socket.close(1001, 'Server shutting down')
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 30_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
