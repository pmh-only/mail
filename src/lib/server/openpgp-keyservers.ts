import { readKeys, type PublicKey } from 'openpgp'

const MAX_KEY_RESPONSE_BYTES = 2_000_000
const LOOKUP_TIMEOUT_MS = 4_000
const FOUND_CACHE_MS = 60 * 60 * 1000
const MISSING_CACHE_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const PROVIDER_RETRY_MS = 60 * 1000

const lookupCache = new Map<string, { expiresAt: number; value: Promise<PublicKey[]> }>()
const providerUnavailableUntil = new Map<string, number>()

export function openPgpKeyEmails(key: PublicKey) {
  return key.getUserIDs().flatMap((userId) => {
    const bracketed = userId.match(/<([^<>\s@]+@[^<>\s@]+)>/)?.[1]
    if (bracketed) return [bracketed.toLowerCase()]
    const bare = userId.trim()
    return /^[^<>\s@]+@[^<>\s@]+$/.test(bare) ? [bare.toLowerCase()] : []
  })
}

function providerUrls(address: string) {
  const encoded = encodeURIComponent(address)
  return [
    `https://keys.openpgp.org/vks/v1/by-email/${encoded}`,
    `https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&exact=on&search=${encoded}`
  ]
}

async function responseText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_KEY_RESPONSE_BYTES) return null
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_KEY_RESPONSE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, length).toString('utf8')
}

async function fetchProviderKeys(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
  useCircuitBreaker: boolean
) {
  const provider = new URL(url).origin
  if (useCircuitBreaker && (providerUnavailableUntil.get(provider) ?? 0) > Date.now()) return []
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/pgp-keys, text/plain' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (useCircuitBreaker) {
      if (response.status === 429 || response.status >= 500) {
        providerUnavailableUntil.set(provider, Date.now() + PROVIDER_RETRY_MS)
      } else {
        providerUnavailableUntil.delete(provider)
      }
    }
    if (!response.ok) return []
    const armoredKeys = await responseText(response)
    const blocks = armoredKeys?.match(
      /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g
    )
    if (!blocks) return []
    return (await Promise.all(blocks.map((block) => readKeys({ armoredKeys: block })))).flat()
  } catch {
    if (useCircuitBreaker) {
      providerUnavailableUntil.set(provider, Date.now() + PROVIDER_RETRY_MS)
    }
    return []
  }
}

export async function lookupOpenPgpKeysByEmail(
  address: string,
  options: {
    fetch?: typeof globalThis.fetch
    requireEncryption?: boolean
    allowMultiple?: boolean
    timeoutMs?: number
    cache?: boolean
  } = {}
): Promise<PublicKey[]> {
  const normalizedAddress = address.trim().toLowerCase()
  if (!/^[^<>\s@]+@[^<>\s@]+$/.test(normalizedAddress)) return []

  const useCache = options.cache !== false && !options.fetch
  const cacheKey = `${normalizedAddress}:${options.requireEncryption === true}:${options.allowMultiple === true}`
  const cached = lookupCache.get(cacheKey)
  if (useCache && cached && cached.expiresAt > Date.now()) {
    lookupCache.delete(cacheKey)
    lookupCache.set(cacheKey, cached)
    return cached.value
  }

  const lookup = (async () => {
    const providerResults = await Promise.all(
      providerUrls(normalizedAddress).map((url) =>
        fetchProviderKeys(
          url,
          options.fetch ?? globalThis.fetch,
          options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
          options.fetch === undefined
        )
      )
    )
    const allMatching = new Map<string, PublicKey>()
    for (const providerKeys of providerResults) {
      const matching = new Map<string, PublicKey>()
      for (const candidate of providerKeys) {
        try {
          if (candidate.isPrivate() || !openPgpKeyEmails(candidate).includes(normalizedAddress)) {
            continue
          }
          const key = candidate as PublicKey
          if (options.requireEncryption) {
            await key.getEncryptionKey()
          }
          matching.set(key.getFingerprint().toLowerCase(), key)
        } catch {
          // Ignore unusable remote certificates without interrupting mail processing.
        }
      }
      if (matching.size === 0) continue
      if (options.allowMultiple === true) {
        for (const [fingerprint, key] of matching) allMatching.set(fingerprint, key)
        continue
      }
      if (matching.size > 1) return []
      return [...matching.values()]
    }
    return [...allMatching.values()]
  })().catch(() => [])

  if (useCache) {
    lookupCache.delete(cacheKey)
    lookupCache.set(cacheKey, { expiresAt: Number.POSITIVE_INFINITY, value: lookup })
    while (lookupCache.size > MAX_CACHE_ENTRIES) {
      // A map larger than its maximum always has a first key.
      const oldestKey = lookupCache.keys().next().value!
      lookupCache.delete(oldestKey)
    }
    void lookup.then((keys) => {
      const current = lookupCache.get(cacheKey)
      if (current?.value === lookup) {
        current.expiresAt = Date.now() + (keys.length > 0 ? FOUND_CACHE_MS : MISSING_CACHE_MS)
      }
    })
  }
  return lookup
}
