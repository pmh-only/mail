import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { withRequestOrigin } from './request-origin.js'

describe('runtime request origin', () => {
  it('leaves header-based origin detection alone when ORIGIN is unset', () => {
    const environment = { PROTOCOL_HEADER: 'x-forwarded-proto' }
    const handler = vi.fn()
    expect(withRequestOrigin(environment, handler)).toBe(handler)
    expect(environment.PROTOCOL_HEADER).toBe('x-forwarded-proto')
  })

  it.each(['http://localhost:5173', 'https://mail.example.com:8443'])(
    'uses %s even when request headers are spoofed',
    (value) => {
      const environment: NodeJS.ProcessEnv = { ORIGIN: value, PORT_HEADER: 'x-forwarded-port' }
      const handler = vi.fn()
      const wrapped = withRequestOrigin(environment, handler)
      const request = {
        headers: { 'x-mail-origin-protocol': 'ftp', 'x-mail-origin-host': 'attacker.example' }
      } as unknown as IncomingMessage
      const response = {} as ServerResponse
      const server = createServer()
      wrapped.call(server, request, response)
      expect(environment.PROTOCOL_HEADER).toBe('x-mail-origin-protocol')
      expect(environment.HOST_HEADER).toBe('x-mail-origin-host')
      expect(environment.PORT_HEADER).toBe('')
      expect(request.headers['x-mail-origin-protocol']).toBe(new URL(value).protocol.slice(0, -1))
      expect(request.headers['x-mail-origin-host']).toBe(new URL(value).host)
      expect(handler).toHaveBeenCalledWith(request, response)
      expect(handler.mock.contexts[0]).toBe(server)
    }
  )

  it.each(['not a URL', 'ftp://mail.example.com'])('rejects invalid origin %s', (ORIGIN) => {
    expect(() => withRequestOrigin({ ORIGIN }, vi.fn())).toThrow()
  })
})
