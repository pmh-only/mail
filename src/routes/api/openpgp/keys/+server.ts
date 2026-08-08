import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  confirmEncryptionKey,
  generateOpenPgpKey,
  importOpenPgpKey,
  listOpenPgpKeys
} from '$lib/server/openpgp-keys'
import { isDemoModeEnabled } from '$lib/server/demo'

export const GET: RequestHandler = async () =>
  json({ keys: isDemoModeEnabled() ? [] : await listOpenPgpKeys() })

export const POST: RequestHandler = async ({ request }) => {
  if (isDemoModeEnabled()) return error(403, 'OpenPGP key management is disabled in demo mode')
  const body = (await request.json()) as Record<string, unknown>
  try {
    if (body.action === 'generate') {
      const key = await generateOpenPgpKey({
        name: typeof body.name === 'string' ? body.name : '',
        email: typeof body.email === 'string' ? body.email : '',
        passphrase: typeof body.passphrase === 'string' ? body.passphrase : undefined,
        algorithm: body.algorithm === 'rsa4096' ? 'rsa4096' : 'curve25519'
      })
      return json({ key }, { status: 201 })
    }
    if (body.action === 'import') {
      const key = await importOpenPgpKey({
        armoredKey: typeof body.armoredKey === 'string' ? body.armoredKey : '',
        passphrase: typeof body.passphrase === 'string' ? body.passphrase : undefined,
        isOwn: body.isOwn !== false,
        makeDefault: body.makeDefault !== false
      })
      return json({ key }, { status: 201 })
    }
    if (body.action === 'confirm-encryption') {
      if (
        typeof body.email !== 'string' ||
        typeof body.fingerprint !== 'string' ||
        typeof body.armoredKey !== 'string'
      ) {
        return error(400, 'Invalid OpenPGP confirmation')
      }
      const key = await confirmEncryptionKey({
        email: body.email,
        fingerprint: body.fingerprint,
        armoredKey: body.armoredKey,
        source: typeof body.source === 'string' ? body.source : 'public-keyserver'
      })
      return json({ key }, { status: 201 })
    }
    return error(400, 'Unknown OpenPGP key action')
  } catch (cause) {
    return error(400, cause instanceof Error ? cause.message : 'Unable to process OpenPGP key')
  }
}
