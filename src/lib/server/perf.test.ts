import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import {
  logServerError,
  logServerEvent,
  payloadBytes,
  perfError,
  perfLog,
  perfMs,
  perfNow
} from './perf'

afterEach(() => vi.restoreAllMocks())

test('reports performance values, payload sizes, and error text', () => {
  vi.spyOn(performance, 'now').mockReturnValueOnce(12.34).mockReturnValueOnce(15.79)
  assert.equal(perfNow(), 12.34)
  assert.equal(perfMs(10), 5.8)
  assert.equal(payloadBytes({ message: 'hi' }), 16)
  const circular: { self?: unknown } = {}
  circular.self = circular
  assert.equal(payloadBytes(circular), null)
  assert.equal(perfError(new Error('failed')), 'failed')
  assert.equal(perfError(42), '42')
})

test('writes serializable and fallback server logs including error stacks', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  perfLog('sync', { count: 1 })
  logServerEvent('sync', { count: 1 })
  const circular: { self?: unknown } = {}
  circular.self = circular
  logServerEvent('sync', circular)
  logServerError('sync', new Error('failed'), { count: 1 })
  logServerError('sync', 'failed')
  assert.equal(log.mock.calls.length, process.env.NODE_ENV === 'production' ? 0 : 1)
  assert.deepEqual(error.mock.calls.slice(0, 2), [
    ['[error] sync {"count":1}'],
    ['[error] sync {"error":"Failed to serialize log details"}']
  ])
  assert.match(error.mock.calls[2][0] as string, /"error":"failed"/)
  assert.match(error.mock.calls[2][0] as string, /"stack":"Error: failed/)
  assert.equal(error.mock.calls[3][0], '[error] sync {"error":"failed"}')
})

test('suppresses performance logs in production', async () => {
  const original = process.env.NODE_ENV
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  process.env.NODE_ENV = 'production'
  vi.resetModules()
  const productionPerf = await import('./perf')
  productionPerf.perfLog('sync', { count: 1 })
  assert.equal(log.mock.calls.length, 0)
  process.env.NODE_ENV = original
  vi.resetModules()
})
