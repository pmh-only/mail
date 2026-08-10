import { describe, expect, it } from 'vitest'
import { errorMessageFromUnknown, readErrorMessage } from './http'

describe('errorMessageFromUnknown', () => {
  it.each([
    [' plain error ', 'plain error'],
    [new Error(' failure '), 'failure'],
    [{ message: 'message error' }, 'message error'],
    [{ error: { details: 'nested error' } }, 'nested error'],
    [[null, '', { message: 'array error' }], 'array error']
  ])('extracts supported error shapes', (value, expected) => {
    expect(errorMessageFromUnknown(value)).toBe(expected)
  })

  it.each([null, undefined, 0, false, '', new Error(''), [], {}, { message: null }])(
    'uses a fallback for %j',
    (value) => {
      expect(errorMessageFromUnknown(value, 'fallback')).toBe('fallback')
    }
  )
})

describe('readErrorMessage', () => {
  it.each([
    [JSON.stringify({ message: 'JSON message' }), 'JSON message'],
    [JSON.stringify({ error: ['Array message'] }), 'Array message'],
    [JSON.stringify('String message'), 'String message'],
    ['plain response', 'plain response']
  ])('reads response text %s', async (body, expected) => {
    expect(await readErrorMessage(new Response(body, { status: 400 }))).toBe(expected)
  })

  it('uses explicit and response-derived fallbacks for empty bodies', async () => {
    expect(await readErrorMessage(new Response('', { status: 400 }), 'explicit')).toBe('explicit')
    expect(
      await readErrorMessage(new Response('', { status: 418, statusText: 'Short and stout' }))
    ).toBe('Short and stout')
    expect(await readErrorMessage(new Response('', { status: 499 }))).toBe('Request failed (499)')
  })

  it('returns text when parsed JSON contains no message', async () => {
    expect(await readErrorMessage(new Response('{"status":400}', { status: 400 }))).toBe(
      '{"status":400}'
    )
  })

  it('uses the fallback when response reading fails', async () => {
    const response = {
      status: 500,
      statusText: '',
      text: () => Promise.reject(new Error('stream failed'))
    } as Response
    expect(await readErrorMessage(response, 'unreadable')).toBe('unreadable')
  })
})
