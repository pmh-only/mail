import { type Server, type Socket } from 'node:net'
import { getImapConfigs } from './config'
import { createImapProxyServer } from './imap-proxy'

let server: Server | null = null
const sockets = new Set<Socket>()

function publicPort() {
  const value = process.env.IMAP_PUBLIC_PORT
  if (!value) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('IMAP_PUBLIC_PORT must be an integer between 1 and 65535')
  }
  return port
}

export async function startPublicImapProxy() {
  const port = publicPort()
  if (port === null || server) return

  const configId = process.env.IMAP_PUBLIC_CONFIG_ID || 'primary'
  const host = process.env.IMAP_PUBLIC_HOST || '127.0.0.1'
  server = createImapProxyServer(async () => {
    const config = (await getImapConfigs()).find((candidate) => candidate.id === configId)
    if (!config) throw new Error(`IMAP configuration "${configId}" was not found`)
    return { host: config.host, port: config.port }
  }, sockets)

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error)
    server?.once('error', handleError)
    server?.listen(port, host, () => {
      server?.off('error', handleError)
      resolve()
    })
  })
  console.log(`[imap-public] listening on ${host}:${port} for configuration ${configId}`)
}

export async function closePublicImapProxy() {
  if (!server) return
  for (const socket of sockets) socket.destroy()
  const activeServer = server
  server = null
  await new Promise<void>((resolve) => activeServer.close(() => resolve()))
}
