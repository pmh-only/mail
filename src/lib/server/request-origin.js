/**
 * Preserve runtime ORIGIN support for the custom HTTP server. SvelteKit 3's adapter only
 * supports a build-time paths.origin, so pass the trusted origin through private headers.
 * @param {NodeJS.ProcessEnv} environment
 * @param {import('node:http').RequestListener} handler
 * @returns {import('node:http').RequestListener}
 */
export function withRequestOrigin(environment, handler) {
  if (!environment.ORIGIN) return handler

  const origin = new URL(environment.ORIGIN)
  if (!['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('ORIGIN must use HTTP or HTTPS')
  }

  environment.PROTOCOL_HEADER = 'x-mail-origin-protocol'
  environment.HOST_HEADER = 'x-mail-origin-host'
  environment.PORT_HEADER = ''

  /** @this {import('node:http').Server} */
  return function (request, response) {
    // Overwrite client-supplied values, including for loopback API requests.
    request.headers['x-mail-origin-protocol'] = origin.protocol.slice(0, -1)
    request.headers['x-mail-origin-host'] = origin.host
    return handler.call(this, request, response)
  }
}
