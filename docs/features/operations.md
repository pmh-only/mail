# Operations dashboard

The authenticated **Operations** page shows live worker and queue telemetry from PostgreSQL. It is
the first place to check when synchronization or delivery appears stalled.

## Dashboard data

- A health score derived from worker heartbeat, failed jobs, and recent errors.
- Worker state and heartbeat age.
- Pending, running, completed, retried, and failed IMAP and SMTP operation totals.
- Active mailbox synchronization progress and latest start and finish times.
- Recent queue errors with operation type, mailbox, UID, attempt count, and status.
- Automatic or manual refresh of current telemetry.

Failed operations can be retried after correcting their cause or deleted when they should not run
again. Deleting a queue record does not reverse a remote action that may already have completed.

## Resynchronization

**Resync mailboxes** resets synchronization state and requests a fresh mailbox scan. Use it after a
provider-side change or when stored state cannot be repaired normally. It is more expensive than a
refresh and should not be the first response to a stopped worker or invalid credentials.

## Configuration

| Item                               | Setting name                                                 | Environment variable                                             | Requirement                                                                             |
| ---------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Worker telemetry                   | None                                                         | `DATABASE_URL`                                                   | Web and worker must share the same PostgreSQL database.                                 |
| Worker health                      | None                                                         | None                                                             | The worker process must run continuously and writes a heartbeat about every 30 seconds. |
| IMAP operations                    | `Settings > IMAP > Host`, `Username / Email`, and `Password` | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | Required for synchronization and queued mailbox actions.                                |
| SMTP operations                    | `Settings > SMTP > Host`, `Username / Email`, and `Password` | `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`, or `SMTP_SERVERS` | Required for queued delivery.                                                           |
| Cooldown timestamps in worker logs | None                                                         | `TZ`                                                             | Optional; defaults to `Asia/Seoul` for that diagnostic timestamp.                       |

The dashboard is unavailable as meaningful telemetry in demo mode because demo data is in-memory
and the worker is not required.
