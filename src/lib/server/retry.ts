export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return (
    msg.includes('authentication') ||
    msg.includes('login failed') ||
    msg.includes('invalid credentials') ||
    msg.includes('[authenticationfailed]') ||
    msg.includes('bad credentials')
  )
}

/**
 * Retry an async operation with exponential back-off.
 * Auth errors are never retried regardless of `shouldRetry`.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseDelayMs?: number
    label?: string
    shouldRetry?: (err: unknown) => boolean
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 2000, label, shouldRetry } = options
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const retryable = shouldRetry ? shouldRetry(err) : !isAuthError(err)
      if (!retryable || attempt === maxAttempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(
        `${label ? `[retry] ${label}` : '[retry]'}: attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms`
      )
      await new Promise<void>((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}
