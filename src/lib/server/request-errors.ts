import type { CaughtError } from '@sveltejs/kit/hooks'

export function shouldLogRequestError(failure: CaughtError) {
  return failure.kind === 'unknown' || failure.error.status >= 500
}
