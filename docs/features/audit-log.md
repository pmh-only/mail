# Security audit log

The authenticated **Audit log** page records recent security and administrative events. It helps the
single owner review changes made through the web application.

## Recorded information

An audit entry can include:

- Action and affected entity type.
- Human-readable summary and structured metadata.
- Authenticated actor email or System for background activity.
- Client IP address and user-agent where a request supplied them.
- Event timestamp.

Metadata fields whose names indicate passwords, secrets, tokens, private keys, credentials, or
authentication material are recursively replaced with `[redacted]` before storage. Avoid treating
the log as a complete forensic trail: it contains application-recorded events, not every database,
host, proxy, or provider action.

The page displays the latest 100 entries. The server-side helper bounds requests to at most 100.

## Configuration

| Item                         | Setting name | Environment variable | Requirement                                                           |
| ---------------------------- | ------------ | -------------------- | --------------------------------------------------------------------- |
| Audit recording              | None         | None                 | Automatic for supported application events.                           |
| Actor and source attribution | None         | None                 | The reverse proxy should preserve trustworthy client address headers. |
| Storage                      | None         | `DATABASE_URL`       | Uses the shared PostgreSQL database.                                  |

There is currently no setting for audit retention, export, or disabling the audit log.
