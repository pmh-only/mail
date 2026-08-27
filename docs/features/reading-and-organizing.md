# Reading and organizing mail

mail stores synchronized messages in PostgreSQL and presents them as individual messages, grouped
threads, or swipeable cards. The same actions update local state immediately and queue the matching
IMAP operation for the worker.

## Views and navigation

- Toggle between individual messages and conversation threads from the mailbox toolbar.
- Filter the current mailbox to all, unread, starred, or pinned mail.
- Use card view for a focused, swipeable message workflow.
- Move between messages with the toolbar, keyboard shortcuts, or the three-pane layout.
- Open a thread to expand its messages, extract AI actions, and keep a private thread note that is
  never sent to participants.

## Message actions

Messages and threads can be marked read or unread, starred, pinned, archived, moved to trash or
spam, restored, or snoozed. Bulk selection supports the same common actions, and Shift-click selects
a range. Snoozed messages are hidden until their chosen time.

The reader exposes sender and recipient details, message metadata, raw HTML and text sources, and
the original raw message. Attachments can be downloaded, while images, PDFs, and videos have an
in-app preview. Potentially risky filenames and MIME mismatches receive a warning.

Opened messages and recent mailbox lists are also available through the best-effort
[offline cache](/features/pwa-and-offline).

## Configuration

| Item                | Setting name                                                                        | Environment variable                          | Requirement                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Live mailbox data   | `Settings > IMAP > Host`, `Username / Email`, and `Password`                        | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD` | Required outside demo mode to receive mail. See [Mail accounts](/guide/mail-accounts).                   |
| Default thread view | `Settings > Interface > Use thread mode on page load`                               | None                                          | Optional; enabled by default.                                                                            |
| Default card view   | `Settings > Interface > Use simplified mailbox view on page load`                   | None                                          | Optional.                                                                                                |
| Spacing             | `Settings > Interface > Display density`                                            | None                                          | Optional; choose Comfortable, Compact, or Condensed.                                                     |
| Message privacy     | `Settings > Privacy > Mailbox message display` and `Trusted remote content senders` | None                                          | Optional; styling is shown and images are blocked by default. See [Privacy controls](/features/privacy). |

No reading-specific environment variable is required after an IMAP account is configured.
