# Features

mail combines a webmail interface with a background worker for synchronization, delivery,
automation, and notifications. Each feature page explains what the feature does and lists only the
Settings fields or environment variables that affect it.

## Mail

| Feature                                                    | What it covers                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Mail accounts](/guide/mail-accounts)                      | IMAP synchronization, SMTP delivery, multiple accounts, and connection testing.          |
| [Reading and organizing](/features/reading-and-organizing) | Message and thread views, attachments, bulk actions, notes, snooze, stars, and pins.     |
| [Mailboxes](/features/mailboxes)                           | Folder visibility and order, the default mailbox, and composed mailboxes.                |
| [Composing and sending](/features/composing-and-sending)   | Rich-text composition, drafts, scheduling, undo send, sender selection, and attachments. |
| [Search](/features/search)                                 | Structured search, natural-language AI search, contact suggestions, and saved searches.  |
| [Contacts and groups](/features/contacts)                  | Address-book management, CSV transfer, mail-history import, and group recipients.        |
| [Signatures](/features/signatures)                         | Reusable HTML signatures and default signature selection.                                |
| [Message templates](/features/templates)                   | Reusable full-message and snippet content in the composer.                               |

## Security and sharing

| Feature                                              | What it covers                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Authentication](/guide/authentication)              | Passwords, passkeys, GitHub, Discord, OIDC, sessions, and the single-owner model. |
| [Privacy controls](/features/privacy)                | Remote-content blocking, trusted senders, link warnings, and attachment warnings. |
| [Mail authentication](/features/mail-authentication) | SPF, DKIM, and DMARC results reported by trusted receiving services.              |
| [OpenPGP](/features/openpgp)                         | Key management, signing, encryption, verification, and decryption.                |
| [Public sharing](/features/public-sharing)           | Revocable public links for individual messages and threads.                       |
| [Read tracking](/features/read-tracking)             | Outgoing tracking pixels, read status, and read push notifications.               |

## Automation

| Feature                                       | What it covers                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [AI features](/features/ai)                   | Compose assistance, summaries, actions, translation, search, and importance classification. |
| [Filters](/features/filters)                  | Ordered rules for incoming and existing messages, previews, and JSON transfer.              |
| [Sender rules](/features/sender-rules)        | Sender blocklists and allowlists applied during synchronization.                            |
| [Auto-cleanup](/features/auto-cleanup)        | Scheduled archival of old messages with dry-run previews.                                   |
| [Push notifications](/features/notifications) | Per-device push, per-mailbox controls, quiet hours, and read controls.                      |

## App and administration

| Feature                                             | What it covers                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Interface](/features/interface)                    | Color mode, themes, list density, card view, thread defaults, and keyboard shortcuts. |
| [PWA and offline access](/features/pwa-and-offline) | Installation, mailto handling, share targets, and local read caches.                  |
| [Settings backup](/features/settings-backup)        | Selective JSON export and restore of non-secret application settings.                 |
| [Operations dashboard](/features/operations)        | Worker health, sync progress, queue telemetry, retries, and resynchronization.        |
| [Audit log](/features/audit-log)                    | Redacted security and administrative event history.                                   |
| [Public IMAP proxy](/features/imap-proxy)           | Optional worker-hosted TCP access to a configured IMAP server.                        |
| [Demo mode](/features/demo-mode)                    | In-memory sample data without PostgreSQL, authentication, or mail services.           |
| [External API and MCP](/reference/api)              | API keys, REST endpoints, and MCP transports.                                         |

## Configuration notation

Feature pages use a path such as `Settings > Notifications > Quiet hours` for values stored through
the application. Environment variable names are shown in uppercase code. When both are available,
the saved Settings value takes precedence unless the page says otherwise.

See [Configuration](/reference/configuration) for installation-wide process settings and precedence.
