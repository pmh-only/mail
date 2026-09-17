# Search

Search runs across synchronized mail rather than querying the IMAP server. Results can span all
stored mailboxes and include each result's source mailbox.

## Full-text and structured search

Typing starts an indexed full-text search after a short delay. Pressing Enter runs the same search
immediately. Plain terms and partial words search message content and metadata. Search indexing is
bounded per message so oversized mail cannot disrupt synchronization.
The following operators narrow results:

| Operator         | Example                  | Meaning                              |
| ---------------- | ------------------------ | ------------------------------------ |
| `from:`          | `from:alice@example.com` | Sender contains the value.           |
| `to:`            | `to:team@example.com`    | Recipient contains the value.        |
| `subject:`       | `subject:"release plan"` | Subject contains the value.          |
| `has:attachment` | `has:attachment`         | Message has at least one attachment. |
| `before:`        | `before:2026-01-01`      | Received before the date.            |
| `after:`         | `after:2026-01-01`       | Received after the date.             |

The search box suggests operators and matching contacts. Searches can be named, saved, reused, and
deleted from the saved-search menu.

## Configuration

| Item                            | Setting name                                | Environment variable | Requirement                                                       |
| ------------------------------- | ------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| Full-text and structured search | None                                        | None                 | No feature-specific configuration. Synchronized mail is required. |
| Saved searches                  | Saved-search menu in the mailbox search bar | None                 | Optional and stored in PostgreSQL.                                |
