import { ROSTACK_API_VERSION } from './rostack-constants'

const problemDetails = {
  'invalid-request': [400, 'Invalid request'],
  'invalid-filter': [400, 'Invalid filter'],
  'unsupported-filter': [400, 'Unsupported filter'],
  'invalid-sort': [400, 'Invalid sort'],
  'invalid-fields': [400, 'Invalid fields'],
  'invalid-cursor': [400, 'Invalid cursor'],
  'authentication-required': [401, 'Authentication required'],
  'permission-denied': [403, 'Permission denied'],
  'resource-not-found': [404, 'Resource not found'],
  'method-not-allowed': [405, 'Method not allowed'],
  'representation-not-acceptable': [406, 'Representation not acceptable'],
  'resource-gone': [410, 'Resource gone'],
  'rate-limited': [429, 'Rate limited'],
  'internal-error': [500, 'Internal error'],
  'service-unavailable': [503, 'Service unavailable']
} as const

export type RostackHttpProblemCode = keyof typeof problemDetails

export function isRostackHttpProblemCode(value: string): value is RostackHttpProblemCode {
  return value in problemDetails
}

export function rostackHeaders(contentType: string) {
  return {
    'content-type': contentType,
    'x-rostack-protocol-version': 'rostack_v1',
    'x-rostack-api-version': ROSTACK_API_VERSION
  }
}

export function rostackJson(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { ...rostackHeaders('application/json'), ...headers }
  })
}

export function rostackProblem(
  code: RostackHttpProblemCode,
  options: { detail?: string; retryAfterMs?: number; headers?: Record<string, string> } = {}
) {
  const [status, title] = problemDetails[code]
  return new Response(
    JSON.stringify({
      type: `https://spec.pmh.codes/problems/${code}`,
      title,
      status,
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.retryAfterMs !== undefined ? { retry_after_ms: options.retryAfterMs } : {})
    }),
    {
      status,
      headers: {
        ...rostackHeaders('application/problem+json'),
        ...(options.retryAfterMs !== undefined
          ? { 'retry-after': String(Math.ceil(options.retryAfterMs / 1000)) }
          : {}),
        ...options.headers
      }
    }
  )
}

export function acceptsJson(value: string | null) {
  if (!value) return true
  const ranges = value.split(',').map((part) => {
    const [mediaType, ...parameters] = part.trim().toLowerCase().split(';')
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='))
    const specificity =
      mediaType === 'application/json'
        ? 2
        : mediaType === 'application/*'
          ? 1
          : mediaType === '*/*'
            ? 0
            : -1
    return { specificity, quality: quality ? Number(quality.trim().slice(2)) : 1 }
  })
  const applicable = ranges.filter((range) => range.specificity >= 0)
  if (applicable.length === 0) return false
  const specificity = Math.max(...applicable.map((range) => range.specificity))
  return applicable.some(
    (range) =>
      range.specificity === specificity && Number.isFinite(range.quality) && range.quality > 0
  )
}
