# Composing and sending

The composer supports new messages, replies, reply-all, and forwarding. SMTP delivery is queued in
PostgreSQL and performed by the worker, so closing the browser does not cancel an accepted send.

## Composer

- Address fields validate To, CC, and BCC recipients and suggest contacts and contact groups.
- Advanced mode can select an SMTP sender, set a display name, add CC/BCC, choose a signature,
  insert a template, use AI, and configure OpenPGP.
- The editor supports headings, inline formatting, lists, alignment, links, rich text, and Markdown
  input.
- Drafts are saved every 30 seconds, when explicitly minimized or closed, and on browser unload when
  possible. Drafts retain recipients, attachments, sender, and OpenPGP choices.
- Recipient warnings flag suspicious or duplicated addressing before delivery.

## Delivery timing

**Send later** accepts one-hour, four-hour, next-day, or custom local times. **Undo send** applies a
short delay only to immediate sends. During that delay the queued job can be canceled and restored
to the composer. Explicitly scheduled mail is not given an additional undo delay.

## Attachments

Up to ten files can be attached directly to the MIME message or uploaded as public download links.
Public-link files are streamed to disk, expire after 30 days, and count against an installation-wide
quota. Direct MIME attachments are constrained by the web process and reverse-proxy request limits.

## Configuration

| Item                           | Setting name                                                               | Environment variable                                             | Requirement                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SMTP delivery                  | `Settings > SMTP > Host`, `Username / Email`, and `Password`               | `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`                    | Required together outside demo mode.                                          |
| SMTP connection                | `Settings > SMTP > Port`, `TLS / SSL`, and `Allow self-signed certificate` | `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_ALLOW_INVALID_CERTIFICATE` | Optional; defaults are `587`, `false`, and `false`.                           |
| Sender address                 | `Settings > SMTP > From address`                                           | `SMTP_FROM`                                                      | Optional; defaults to the SMTP username.                                      |
| Additional senders             | `Settings > SMTP > Secondary SMTP servers`                                 | `SMTP_SERVERS`                                                   | Optional.                                                                     |
| Undo send                      | `Settings > SMTP > Undo send delay`                                        | `SMTP_UNDO_SEND_SECONDS`                                         | Optional; 0 to 30 seconds, default `0`.                                       |
| Stored SMTP password           | None                                                                       | `MAIL_SECRET_KEY`                                                | Required to encrypt a password saved through Settings; must match the worker. |
| Direct attachment request size | None                                                                       | `BODY_SIZE_LIMIT`                                                | Optional; defaults to `Infinity`. The reverse proxy needs a compatible limit. |
| Public-link file directory     | None                                                                       | `PUBLIC_ATTACHMENT_DIR`                                          | Optional; defaults to `data/public-attachments` and must be persistent.       |
| Public-link file limit         | None                                                                       | `PUBLIC_ATTACHMENT_MAX_BYTES`                                    | Optional; defaults to 100 MiB per file.                                       |
| Public-link total quota        | None                                                                       | `PUBLIC_ATTACHMENT_TOTAL_BYTES`                                  | Optional; defaults to 2 GiB.                                                  |

The worker must share `DATABASE_URL` and `MAIL_SECRET_KEY` with the web process. See
[Read tracking](/features/read-tracking), [OpenPGP](/features/openpgp), [Signatures](/features/signatures),
and [Message templates](/features/templates) for optional composer features.
