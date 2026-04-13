import { ImapFlow } from 'imapflow'
import { withRetry } from '$lib/server/retry'

const IMAP_CONNECT_TIMEOUT_MS = 20_000

async function connectImap(config: MailConfig, label: string): Promise<ImapFlow> {
  return withRetry(
    async () => {
      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        logger: false,
        connectionTimeout: IMAP_CONNECT_TIMEOUT_MS
      })
      try {
        await client.connect()
        return client
      } catch (err) {
        try {
          client.close()
        } catch {
          /* ignore */
        }
        throw err
      }
    },
    { label, maxAttempts: 3, baseDelayMs: 1000 }
  )
}

type MailConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

type MarkReadJob = {
  type: 'mark_read'
  uid: number
  mailbox: string
}

type MoveJob = {
  type: 'move'
  uid: number
  sourceMailbox: string
  targetMailbox: string
}

type ImapJob = MarkReadJob | MoveJob

const queue: ImapJob[] = []
let workerRunning = false
let configResolver: (() => Promise<MailConfig | null> | MailConfig | null) | null = null

export function registerImapConfig(resolver: () => Promise<MailConfig | null> | MailConfig | null) {
  configResolver = resolver
}

export function enqueueMarkRead(uid: number, mailbox: string) {
  if (queue.some((j) => j.type === 'mark_read' && j.uid === uid && j.mailbox === mailbox)) return
  queue.push({ type: 'mark_read', uid, mailbox })
  startWorker()
}

export function enqueueMoveMessage(uid: number, sourceMailbox: string, targetMailbox: string) {
  // Replace any existing move for the same uid+source with the latest target
  const existing = queue.findIndex(
    (j) => j.type === 'move' && j.uid === uid && j.sourceMailbox === sourceMailbox
  )
  if (existing !== -1) queue.splice(existing, 1)
  queue.push({ type: 'move', uid, sourceMailbox, targetMailbox })
  startWorker()
}

function startWorker() {
  if (workerRunning) return
  workerRunning = true
  void runWorker()
}

async function runWorker() {
  try {
    while (queue.length > 0) {
      await flushQueue()
    }
  } finally {
    workerRunning = false
  }
}

async function flushQueue() {
  const config = await configResolver?.()
  if (!config) {
    queue.length = 0
    return
  }

  const batch = queue.splice(0, queue.length)

  // Group mark_read by mailbox
  const readByMailbox = new Map<string, number[]>()
  // Group moves by source mailbox → target → uids
  const movesBySource = new Map<string, Map<string, number[]>>()

  for (const job of batch) {
    if (job.type === 'mark_read') {
      const uids = readByMailbox.get(job.mailbox) ?? []
      uids.push(job.uid)
      readByMailbox.set(job.mailbox, uids)
    } else if (job.type === 'move') {
      const targets = movesBySource.get(job.sourceMailbox) ?? new Map<string, number[]>()
      const uids = targets.get(job.targetMailbox) ?? []
      uids.push(job.uid)
      targets.set(job.targetMailbox, uids)
      movesBySource.set(job.sourceMailbox, targets)
    }
  }

  const tasks: Promise<void>[] = []
  for (const [mailbox, uids] of readByMailbox) {
    tasks.push(runMarkRead(config, mailbox, uids))
  }
  for (const [sourceMailbox, targets] of movesBySource) {
    for (const [targetMailbox, uids] of targets) {
      tasks.push(runMove(config, sourceMailbox, targetMailbox, uids))
    }
  }
  await Promise.all(tasks)
}

async function runMarkRead(config: MailConfig, mailbox: string, uids: number[]) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `mark-read ${mailbox}`)
    const lock = await client.getMailboxLock(mailbox)
    try {
      await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } catch {
    // Jobs are dropped after retries are exhausted; DB was already updated optimistically
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}

async function runMove(
  config: MailConfig,
  sourceMailbox: string,
  targetMailbox: string,
  uids: number[]
) {
  let client: ImapFlow | null = null
  try {
    client = await connectImap(config, `move ${sourceMailbox}→${targetMailbox}`)
    const lock = await client.getMailboxLock(sourceMailbox)
    try {
      await client.messageMove(uids.join(','), targetMailbox, { uid: true })
    } finally {
      lock.release()
    }
  } catch {
    // Jobs are dropped after retries are exhausted; DB was already updated optimistically
  } finally {
    if (client) {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }
  }
}
