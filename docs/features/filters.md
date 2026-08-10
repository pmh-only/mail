# Filters

Filters process incoming messages after synchronization. They can also be previewed or run manually
against existing stored mail.

## Conditions and order

A rule can require **all** or **any** of several conditions. Conditions inspect From, To, Subject,
or CC with `contains`, `equals`, `starts with`, or `ends with`. Comparisons are case-insensitive.

Enabled rules run in their displayed order. The first matching rule wins for each message, so place
specific rules before broad ones. Sender rules run first; a blocked message is not processed by the
normal filter list.

## Actions

Active actions are:

- Mark as read.
- Move to trash. The `Delete` UI action currently uses the same trash destination rather than
  permanently deleting mail.
- Move to a named IMAP folder.
- Star the message.
- Apply an IMAP keyword label.

Forward and auto-reply appear as planned actions but cannot be enabled until additional SMTP safety
controls exist.

## Preview, run, and transfer

Preview shows up to 20 recent matches without changing mail. **Run now** scans existing messages and
queues the same IMAP changes as incoming processing. Rules can be exported as versioned JSON and
imported with duplicate detection and validation.

## Configuration

| Item                   | Setting name                                                    | Environment variable                                             | Requirement                                                                               |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Rule conditions        | `Settings > Filters > Match`, `Field`, `Condition`, and `Value` | None                                                             | At least one non-empty condition is required.                                             |
| Rule action            | `Settings > Filters > Action` and, when shown, `Target`         | None                                                             | A target folder or label is required for actions that need one.                           |
| Rule execution         | `Settings > Filters > Run now`                                  | None                                                             | Optional for existing mail; incoming filters run automatically.                           |
| Import and export      | `Settings > Filters > Import` or `Export`                       | None                                                             | Optional.                                                                                 |
| Remote mailbox changes | `Settings > IMAP > Host`, `Username / Email`, and `Password`    | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | A running worker and writable IMAP account are required to apply flags or moves upstream. |

No filter-specific environment variable exists. Rules are stored in PostgreSQL.
