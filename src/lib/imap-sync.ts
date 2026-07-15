export function newUidRange(lastUid: number, uidNext: number): string | null {
  const highestUid = uidNext - 1
  return highestUid > lastUid ? `${lastUid + 1}:${highestUid}` : null
}

export function uidValidityChanged(stored: number | null, current: number): boolean {
  return stored !== null && stored !== current
}

export function syncBatchComplete(fetchedCount: number, storedCount: number): boolean {
  return fetchedCount === storedCount
}

export function seenJob(uid: number, mailbox: string, seen: boolean) {
  return {
    type: seen ? 'mark_read' : 'mark_unread',
    dedupeKey: `seen:${mailbox}:${uid}`
  }
}

export function mailboxStatusUnchanged(
  state: { lastUid: number; uidValidity: number | null; highestModseq: bigint | null },
  status: { uidNext?: number; uidValidity?: bigint; highestModseq?: bigint }
) {
  return (
    state.uidValidity !== null &&
    state.highestModseq !== null &&
    status.uidNext !== undefined &&
    status.uidValidity !== undefined &&
    status.highestModseq !== undefined &&
    state.lastUid === status.uidNext - 1 &&
    state.uidValidity === Number(status.uidValidity) &&
    state.highestModseq === status.highestModseq
  )
}

export function shouldUseStatusFastPath(
  force: boolean,
  reconciliationFresh: boolean,
  state: { lastUid: number; uidValidity: number | null; highestModseq: bigint | null },
  status: { uidNext?: number; uidValidity?: bigint; highestModseq?: bigint }
) {
  return !force && reconciliationFresh && mailboxStatusUnchanged(state, status)
}

export function condstoreChangedSince(
  advertised: boolean,
  rejected: boolean,
  highestModseq: bigint | null
) {
  return advertised && !rejected ? (highestModseq ?? undefined) : undefined
}

export function isCondstoreRejection(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(condstore|changedSince|modseq|unsupported|not supported|BAD|NO)\b/i.test(message)
}

export function draftJobDedupeKey(id: number) {
  return `draft:${id}`
}

export function draftDeleteJob(
  draftId: number,
  mailbox: string,
  uid: number,
  uidValidity: number | null,
  now: Date
) {
  return {
    type: 'delete_draft',
    mailbox,
    uid,
    uidValidity,
    draftId,
    status: 'pending',
    dedupeKey: `draft-delete:${draftId}:${uid}`,
    attemptCount: 0,
    availableAt: now,
    createdAt: now,
    updatedAt: now
  }
}

export function previousDraftUidToDelete(
  previous: { mailbox: string | null; uid: number | null; uidValidity: number | null },
  current: { mailbox: string; uid: number; uidValidity: number | null }
) {
  return previous.uid &&
    previous.uid !== current.uid &&
    previous.mailbox === current.mailbox &&
    previous.uidValidity === current.uidValidity
    ? previous.uid
    : null
}

export function draftAppendMatches(uids: number[]) {
  if (uids.length === 0) return { uid: null, duplicates: [] }
  const uid = Math.max(...uids)
  return { uid, duplicates: uids.filter((candidate) => candidate !== uid) }
}

export function reconcileMailboxRows<T extends { uid: number; flags: string }>(
  rows: T[],
  remoteUids: ReadonlySet<number>,
  remoteFlags: ReadonlyMap<number, string>,
  protectedUids: ReadonlySet<number>
) {
  const changes: Array<{ row: T; action: 'delete' } | { row: T; action: 'flags'; flags: string }> =
    []
  for (const row of rows) {
    if (protectedUids.has(row.uid)) continue
    if (!remoteUids.has(row.uid)) {
      changes.push({ row, action: 'delete' })
      continue
    }
    const flags = remoteFlags.get(row.uid)
    if (flags !== undefined && flags !== row.flags) changes.push({ row, action: 'flags', flags })
  }
  return changes
}
