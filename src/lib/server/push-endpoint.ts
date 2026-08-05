import { Agent, request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { lookup } from 'node:dns/promises'
import webpush from 'web-push'

export const MAX_PUSH_SUBSCRIPTIONS = 20
export const MAX_PUSH_REQUEST_BYTES = 16 * 1024
const MAX_ENDPOINT_LENGTH = 2048
const REQUEST_TIMEOUT_MS = 5000
const MAX_RESPONSE_BYTES = 64 * 1024

export type ValidPushSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

function parseIpv4(value: string) {
  const parts = value.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null
  }
  return parts
}

export function isPublicIpAddress(value: string) {
  const normalized = value.toLowerCase().split('%')[0]
  if (normalized.startsWith('::ffff:')) return isPublicIpAddress(normalized.slice(7))
  if (isIP(normalized) === 4) {
    const octets = parseIpv4(normalized)
    if (!octets) return false
    const [a, b] = octets
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0)
    )
  }
  if (isIP(normalized) === 6) {
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    )
  }
  return false
}

function decodeBase64Url(value: unknown, maxLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return null
  }
}

export function validatePushSubscription(value: unknown): ValidPushSubscription {
  if (!value || typeof value !== 'object') throw new Error('Invalid subscription')
  const body = value as Record<string, unknown>
  const keys = body.keys as Record<string, unknown> | undefined
  if (typeof body.endpoint !== 'string' || body.endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new Error('Invalid push endpoint')
  }

  let url: URL
  try {
    url = new URL(body.endpoint)
  } catch {
    throw new Error('Invalid push endpoint')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.home.arpa') ||
    (isIP(hostname) !== 0 && !isPublicIpAddress(hostname))
  ) {
    throw new Error('Unsafe push endpoint')
  }

  const p256dh = decodeBase64Url(keys?.p256dh, 128)
  const auth = decodeBase64Url(keys?.auth, 64)
  if (p256dh?.length !== 65 || p256dh[0] !== 4 || auth?.length !== 16) {
    throw new Error('Invalid push encryption keys')
  }

  return { endpoint: url.href, keys: { p256dh: String(keys?.p256dh), auth: String(keys?.auth) } }
}

async function publicAddressFor(hostname: string) {
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error('Push endpoint resolved to a private address')
    return { address: hostname, family: isIP(hostname) as 4 | 6 }
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('Push endpoint resolved to a private address')
  }
  return addresses[0]
}

export async function sendWebPushSafely(
  subscription: ValidPushSubscription,
  payload: string,
  ttl: number
) {
  const url = new URL(subscription.endpoint)
  const resolved = await publicAddressFor(url.hostname.replace(/^\[|\]$/g, ''))
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all) {
      callback(null, [resolved])
      return
    }
    callback(null, resolved.address, resolved.family)
  }
  const agent = new Agent({ lookup: pinnedLookup })
  const details = webpush.generateRequestDetails(subscription, payload, { TTL: ttl })

  await new Promise<void>((resolve, reject) => {
    const request = httpsRequest(details.endpoint, {
      method: details.method,
      headers: details.headers,
      agent
    })
    const timer = setTimeout(
      () => request.destroy(new Error('Push request timed out')),
      REQUEST_TIMEOUT_MS
    )
    request.on('response', (response) => {
      let received = 0
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > MAX_RESPONSE_BYTES) response.destroy(new Error('Push response is too large'))
      })
      response.on('end', () => {
        clearTimeout(timer)
        const statusCode = response.statusCode ?? 500
        if (statusCode >= 200 && statusCode < 300) resolve()
        else reject(Object.assign(new Error(`Push service returned ${statusCode}`), { statusCode }))
      })
      response.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end(details.body)
  }).finally(() => agent.destroy())
}
