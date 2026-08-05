import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const API_KEY_PREFIX = 'pmail_'
const SCRYPT_KEY_LENGTH = 64

function deriveApiKeyHash(value: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(value, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(Buffer.from(derivedKey))
    })
  })
}

export function generateApiKeyValue() {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function apiKeyPrefix(value: string) {
  return `${value.slice(0, 14)}...`
}

export async function hashApiKey(value: string) {
  const salt = randomBytes(16)
  const hash = await deriveApiKeyHash(value, salt)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyApiKeyHash(value: string, storedHash: string) {
  const [algorithm, encodedSalt, encodedHash] = storedHash.split('$')
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedHash) return false

  try {
    const expectedHash = Buffer.from(encodedHash, 'base64url')
    if (expectedHash.length !== SCRYPT_KEY_LENGTH) return false

    const hash = await deriveApiKeyHash(value, Buffer.from(encodedSalt, 'base64url'))
    return timingSafeEqual(hash, expectedHash)
  } catch {
    return false
  }
}

export function bearerApiKey(headers: Headers) {
  const authorization = headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}
