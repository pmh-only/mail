export type RostackProblemCode =
  | 'invalid-request'
  | 'invalid-filter'
  | 'unsupported-filter'
  | 'invalid-sort'
  | 'invalid-fields'
  | 'invalid-cursor'
  | 'resource-not-found'
  | 'authentication-required'
  | 'permission-denied'
  | 'method-not-allowed'
  | 'representation-not-acceptable'
  | 'resource-gone'
  | 'rate-limited'
  | 'internal-error'
  | 'service-unavailable'
  | 'cursor_scope_mismatch'
  | 'cursor_unavailable'

export class RostackError extends Error {
  constructor(
    public status: number,
    public code: RostackProblemCode,
    message: string
  ) {
    super(message)
  }
}
