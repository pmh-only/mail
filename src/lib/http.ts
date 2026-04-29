function extractErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }

  if (value instanceof Error) {
    const text = value.message.trim()
    return text || null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractErrorMessage(item)
      if (message) return message
    }

    return null
  }

  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>

  for (const key of ['message', 'error', 'details']) {
    const message = extractErrorMessage(record[key])
    if (message) return message
  }

  return null
}

export function errorMessageFromUnknown(error: unknown, fallback = 'Something went wrong.') {
  return extractErrorMessage(error) ?? fallback
}

export async function readErrorMessage(
  response: Response,
  fallback = response.statusText || `Request failed (${response.status})`
) {
  try {
    const text = (await response.text()).trim()
    if (!text) return fallback

    try {
      return extractErrorMessage(JSON.parse(text)) ?? text
    } catch {
      return text
    }
  } catch {
    return fallback
  }
}
