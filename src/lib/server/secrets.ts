import { env } from '$lib/server/env-private'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const IV_BYTES = 12

function getKey(): Buffer | null {
  const secretKey = env.MAIL_SECRET_KEY?.trim()
  if (!secretKey) return null

  return createHash('sha256').update(secretKey).digest()
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function isSecretEncryptionConfigured(): boolean {
  return Boolean(getKey())
}

export function getSecretStorageStatus() {
  return isSecretEncryptionConfigured()
    ? {
        configured: true,
        text: 'Mail passwords, private keys, and authentication provider secrets are encrypted at rest.'
      }
    : {
        configured: false,
        text: 'Set MAIL_SECRET_KEY to encrypt newly saved mail, private keys, and authentication secrets.'
      }
}

export function encryptSecret(value: string): string {
  const key = getKey()
  if (!key) return value
  if (isEncryptedSecret(value)) return value

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return ''
  if (!isEncryptedSecret(value)) return value

  const key = getKey()
  if (!key) return ''

  const parts = value.slice(PREFIX.length).split(':')
  if (parts.length !== 3) return ''

  const [ivBase64, tagBase64, ciphertextBase64] = parts
  const iv = Buffer.from(ivBase64, 'base64')
  const tag = Buffer.from(tagBase64, 'base64')
  const ciphertext = Buffer.from(ciphertextBase64, 'base64')

  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) return ''

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
