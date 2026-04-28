const encoder = new TextEncoder()
const isDev = process.env.NODE_ENV !== 'production'

function round(ms: number) {
  return Number(ms.toFixed(1))
}

export function perfNow() {
  return performance.now()
}

export function perfMs(start: number) {
  return round(performance.now() - start)
}

export function payloadBytes(value: unknown) {
  try {
    return encoder.encode(JSON.stringify(value)).length
  } catch {
    return null
  }
}

export function perfLog(scope: string, details: Record<string, unknown>) {
  if (!isDev) return
  console.log(`[perf] ${scope} ${JSON.stringify(details)}`)
}

export function perfError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function stringifyLogDetails(details: Record<string, unknown>) {
  try {
    return JSON.stringify(details)
  } catch {
    return JSON.stringify({ error: 'Failed to serialize log details' })
  }
}

export function logServerEvent(scope: string, details: Record<string, unknown>) {
  console.error(`[error] ${scope} ${stringifyLogDetails(details)}`)
}

export function logServerError(
  scope: string,
  error: unknown,
  details: Record<string, unknown> = {}
) {
  const payload: Record<string, unknown> = {
    ...details,
    error: perfError(error)
  }

  if (error instanceof Error && error.stack) {
    payload.stack = error.stack
  }

  console.error(`[error] ${scope} ${stringifyLogDetails(payload)}`)
}
