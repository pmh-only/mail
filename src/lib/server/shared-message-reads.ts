export class SharedMessageReads {
  private readonly messageIds = new Map<string, string>()
  private readonly threadMessageIds = new Map<string, string[]>()
  private readonly readTokens = new Set<string>()

  add(token: string, messageId: string, messageIds?: string[]) {
    this.messageIds.set(token, messageId)
    if (messageIds && messageIds.length > 0) {
      this.threadMessageIds.set(token, messageIds)
    }
  }

  findExistingToken(messageId: string, messageIds?: string[]) {
    const targetJson = messageIds ? JSON.stringify(messageIds) : null
    for (const [token, mId] of this.messageIds.entries()) {
      if (mId !== messageId) continue
      const existingThread = this.threadMessageIds.get(token)
      if (targetJson) {
        if (existingThread && JSON.stringify(existingThread) === targetJson) return token
      } else {
        if (!existingThread || (existingThread.length === 1 && existingThread[0] === messageId))
          return token
      }
    }
    return null
  }

  getMessageId(token: string) {
    return this.messageIds.get(token) ?? null
  }

  getMessageIds(token: string) {
    return (
      this.threadMessageIds.get(token) ??
      (this.messageIds.has(token) ? [this.messageIds.get(token)!] : null)
    )
  }

  markRead(token: string) {
    if (this.messageIds.has(token)) this.readTokens.add(token)
  }

  count(messageId: string) {
    let count = 0
    for (const token of this.readTokens) {
      const ids = this.getMessageIds(token)
      if (ids && ids.includes(messageId)) count += 1
    }
    return count
  }

  clear() {
    this.messageIds.clear()
    this.threadMessageIds.clear()
    this.readTokens.clear()
  }
}
