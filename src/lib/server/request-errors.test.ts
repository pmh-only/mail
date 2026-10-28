import { describe, expect, it } from 'vitest'
import { shouldLogRequestError } from './request-errors'

describe('request error logging', () => {
  it.each(['app', 'framework'] as const)('skips expected %s client errors', (kind) => {
    for (const status of [400, 401, 403, 404, 429, 499]) {
      expect(shouldLogRequestError({ kind, error: { status, message: 'Client error' } })).toBe(
        false
      )
    }
  })

  it('skips validation failures', () => {
    expect(
      shouldLogRequestError({
        kind: 'validation',
        error: { status: 400, message: 'Bad Request' },
        issues: []
      })
    ).toBe(false)
  })

  it.each(['app', 'framework'] as const)('logs %s server failures', (kind) => {
    expect(
      shouldLogRequestError({
        kind,
        error: { status: 500, message: 'Server failure' }
      })
    ).toBe(true)
  })

  it.each([new Error('Unexpected failure'), null, { status: 401 }])(
    'always logs unknown failures without trusting their status',
    (error) => {
      expect(shouldLogRequestError({ kind: 'unknown', error })).toBe(true)
    }
  )
})
