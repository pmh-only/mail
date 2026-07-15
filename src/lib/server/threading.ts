export type ThreadHeader = {
  messageId: string
  subject: string
  inReplyTo: string | null
  references: string | null
  receivedAt: Date | null
}

export function referenceCandidates(
  message: Pick<ThreadHeader, 'messageId' | 'inReplyTo' | 'references'>
) {
  const references = message.references?.split(/\s+/).filter(Boolean) ?? []
  return (references.length > 0 ? references : message.inReplyTo ? [message.inReplyTo] : []).filter(
    (candidate) => candidate !== message.messageId
  )
}

export function baseSubject(subject: string) {
  let value = subject.trim()
  let isReply = false
  const prefix = /^(?:\[[^\]]+\]\s*)?(?:re|fw|fwd)(?:\[[^\]]*\])?\s*:\s*/i

  while (prefix.test(value)) {
    value = value.replace(prefix, '')
    isReply = true
  }

  if (/\s*\(fwd\)\s*$/i.test(value)) {
    value = value.replace(/\s*\(fwd\)\s*$/i, '')
    isReply = true
  }

  return { value: value.trim().toLowerCase(), isReply }
}

export function assignThreadKeys<T extends ThreadHeader>(messages: T[]) {
  const ordered = [...messages].sort(
    (a, b) =>
      (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0) ||
      a.messageId.localeCompare(b.messageId)
  )
  const byId = new Map(ordered.map((message) => [message.messageId, message]))
  const resolving = new Set<string>()
  const keys = new Map<string, string>()

  function resolve(message: T): string {
    const cached = keys.get(message.messageId)
    if (cached) return cached
    if (resolving.has(message.messageId)) return message.messageId

    resolving.add(message.messageId)
    const firstReference = referenceCandidates(message)[0]
    const key = firstReference
      ? byId.has(firstReference)
        ? resolve(byId.get(firstReference)!)
        : firstReference
      : message.messageId
    resolving.delete(message.messageId)
    keys.set(message.messageId, key)
    return key
  }

  for (const message of ordered) resolve(message)

  const subjectRoots = new Map<string, string>()
  for (const message of ordered) {
    const subject = baseSubject(message.subject)
    if (subject.value && !subject.isReply) {
      if (!subjectRoots.has(subject.value)) {
        subjectRoots.set(subject.value, keys.get(message.messageId)!)
      }
    }
  }

  for (const message of ordered) {
    const subject = baseSubject(message.subject)
    if (subject.value && subject.isReply && referenceCandidates(message).length === 0) {
      const root = subjectRoots.get(subject.value)
      if (root) keys.set(message.messageId, root)
      else subjectRoots.set(subject.value, keys.get(message.messageId)!)
    }
  }

  return keys
}

export function orderThread<T extends ThreadHeader>(messages: T[]) {
  const byId = new Map(messages.map((message) => [message.messageId, message]))
  const children = new Map<string, T[]>()
  const roots: T[] = []

  for (const message of messages) {
    const candidates = referenceCandidates(message)
    const parentId =
      (message.inReplyTo && byId.has(message.inReplyTo) ? message.inReplyTo : null) ??
      [...candidates].reverse().find((candidate) => byId.has(candidate))

    if (!parentId || parentId === message.messageId) roots.push(message)
    else children.set(parentId, [...(children.get(parentId) ?? []), message])
  }

  const sort = (a: T, b: T) =>
    (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0) ||
    a.messageId.localeCompare(b.messageId)
  const result: Array<T & { threadDepth: number }> = []
  const visited = new Set<string>()

  function visit(message: T, depth: number) {
    if (visited.has(message.messageId)) return
    visited.add(message.messageId)
    result.push({ ...message, threadDepth: depth })
    for (const child of (children.get(message.messageId) ?? []).sort(sort)) visit(child, depth + 1)
  }

  for (const root of roots.sort(sort)) visit(root, 0)
  for (const message of [...messages].sort(sort)) visit(message, 0)
  return result
}
