# Auto-cleanup

Auto-cleanup archives old messages. It never permanently deletes mail and skips Archive, Trash, and
Spam folders.

## Rules

A rule selects messages older than a whole number of days, either in one mailbox or across all
regular mailboxes. The minimum age is seven days. Each rule can be enabled or disabled and records
its latest run time.

Use **Dry-run preview** before saving a rule. The preview reports recent matches and warns when the
chosen mailbox has a role that cleanup intentionally skips.

## Scheduling

The worker checks cleanup rules hourly. Each run archives at most 50 messages per rule so a large
backlog is processed gradually. **Run cleanup** starts the same process on demand. An Archive mailbox
must be detectable; otherwise no messages are moved.

## Configuration

| Item                | Setting name                                                                         | Environment variable                                             | Requirement                                  |
| ------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Cleanup age         | `Settings > Cleanup > Older than`                                                    | None                                                             | Required; minimum 7 days.                    |
| Mailbox scope       | `Settings > Cleanup > Mailbox path`                                                  | None                                                             | Optional; empty means all regular mailboxes. |
| Rule state          | `Settings > Cleanup` rule toggle                                                     | None                                                             | Optional; new rules are enabled by default.  |
| Automatic execution | None                                                                                 | None                                                             | Requires a continuously running worker.      |
| Archive destination | `Settings > IMAP > Host`, `Username / Email`, and `Password`, plus an Archive folder | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | Required for cleanup to move messages.       |

There is no cleanup interval environment variable; the worker interval and per-run limit are fixed.
