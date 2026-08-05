import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { isAuthError, isRateLimitError, withRetry } from './retry'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('recognizes rate-limit and authentication errors from supported error shapes', () => {
  assert.equal(isRateLimitError(new Error('Rate limit exceeded')), true)
  assert.equal(isRateLimitError({ responseText: 'Too many simultaneous connections' }), true)
  assert.equal(isRateLimitError({ response: '[ALERT]' }), true)
  assert.equal(isRateLimitError('offline'), false)
  assert.equal(isAuthError(new Error('Login failed: bad credentials')), true)
  assert.equal(isAuthError('authentication'), false)
  assert.equal(isAuthError(new Error('offline')), false)
})

test('retries retryable failures with exponential delays and labels warnings', async () => {
  vi.useFakeTimers()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const fn = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('ok')
  const result = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, label: 'sync' })
  await vi.runAllTimersAsync()
  assert.equal(await result, 'ok')
  assert.equal(fn.mock.calls.length, 3)
  assert.deepEqual(warn.mock.calls, [
    ['[retry] sync: attempt 1/3 failed — retrying in 10ms'],
    ['[retry] sync: attempt 2/3 failed — retrying in 20ms']
  ])
})

test('uses the default retry label when none is supplied', async () => {
  vi.useFakeTimers()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const fn = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok')
  const result = withRetry(fn, { baseDelayMs: 1 })
  await vi.runAllTimersAsync()
  assert.equal(await result, 'ok')
  assert.deepEqual(warn.mock.calls, [['[retry]: attempt 1/3 failed — retrying in 1ms']])
})

test('does not retry terminal, auth, rate-limit, or rejected custom errors', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const cases: Array<[Error, { maxAttempts?: number; shouldRetry?: (error: unknown) => boolean }]> =
    [
      [new Error('authentication failed'), {}],
      [new Error('rate limit'), {}],
      [new Error('no'), { shouldRetry: () => false }],
      [new Error('last'), { maxAttempts: 1 }]
    ]
  for (const [error, options] of cases) {
    const fn = vi.fn().mockRejectedValue(error)
    await assert.rejects(withRetry(fn, options), error)
    assert.equal(fn.mock.calls.length, 1)
  }
  assert.equal(warn.mock.calls.length, 0)
})
