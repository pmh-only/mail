import { isAlwaysReadMailbox } from './mailbox.ts'

type MessageCopy = {
  messageId: string
  mailbox: string
  flags: string
}

export function changedReadStateCopies<T extends MessageCopy>(
  rows: T[],
  messageIds: ReadonlySet<string>,
  seen: boolean
) {
  return rows.flatMap((row) => {
    if (!messageIds.has(row.messageId) || (!seen && isAlwaysReadMailbox(row.mailbox))) return []

    const flags = JSON.parse(row.flags) as string[]
    if (flags.includes('\\Seen') === seen) return []

    return [
      {
        ...row,
        flags: JSON.stringify(
          seen ? [...flags, '\\Seen'] : flags.filter((flag) => flag !== '\\Seen')
        )
      }
    ]
  })
}
