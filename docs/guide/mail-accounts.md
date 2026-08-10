# Mail accounts

mail connects to existing providers through IMAP for incoming mail and SMTP for outgoing mail. It
does not host mailboxes or accept inbound SMTP delivery.

## Configure an account

The first-time setup screen accepts one optional IMAP and SMTP account. After signing in, use
Settings to add, update, or remove accounts.

For each IMAP account, provide:

- A unique name and ID
- Host, port, username, and password
- Whether the connection uses implicit TLS
- The initial mailbox, usually `INBOX`
- A polling interval

For each SMTP account, provide:

- A unique name and ID
- Host, port, username, and password
- Whether the connection uses implicit TLS
- The default From address

Use implicit TLS for the provider's TLS port, commonly IMAP `993` and SMTP `465`. SMTP submission on
port `587` commonly starts without implicit TLS and upgrades with STARTTLS. Only allow an invalid
certificate for a trusted private server whose certificate you have verified another way.

## Run the worker

The web process queues mail operations; it does not execute them. Keep one worker process running to
synchronize mailboxes, watch for changes, dispatch IMAP actions, and deliver queued SMTP messages.

Both processes must use the same `DATABASE_URL` and `MAIL_SECRET_KEY`. They must also see the same
mail configuration, either from PostgreSQL-backed Settings or from matching environment variables.

## Configuration

Settings are recommended because they support multiple accounts and can be changed without editing
deployment files. Environment variables remain useful as a deployment fallback.

### Incoming mail

The primary account exists only when its host, username, and password are all available. Saved
Settings values take precedence over the corresponding scalar environment values.

| Item                               | Setting name                                      | Environment variable             | Default or requirement                             |
| ---------------------------------- | ------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Host                               | `Settings > IMAP > Host`                          | `IMAP_HOST`                      | Required.                                          |
| Port                               | `Settings > IMAP > Port`                          | `IMAP_PORT`                      | `993`.                                             |
| Username                           | `Settings > IMAP > Username / Email`              | `IMAP_USER`                      | Required.                                          |
| Password                           | `Settings > IMAP > Password`                      | `IMAP_PASSWORD`                  | Required.                                          |
| Implicit TLS                       | `Settings > IMAP > TLS / SSL`                     | `IMAP_SECURE`                    | `true`.                                            |
| Certificate verification exception | `Settings > IMAP > Allow self-signed certificate` | `IMAP_ALLOW_INVALID_CERTIFICATE` | `false`; enable only for a trusted private server. |
| Initial folder                     | `Settings > IMAP > Default Mailbox`               | `IMAP_MAILBOX`                   | `INBOX`.                                           |
| Poll interval                      | `Settings > IMAP > Poll interval (seconds)`       | `IMAP_POLL_SECONDS`              | `15`; Settings requires at least 5 seconds.        |
| Additional accounts                | `Settings > IMAP > Secondary IMAP servers`        | `IMAP_SERVERS`                   | Optional JSON array.                               |

Each `IMAP_SERVERS` object supports `id`, `name`, `host`, `port`, `secure`,
`allowInvalidCertificate`, `user`, `password`, `mailbox`, and `pollSeconds`. PostgreSQL-backed and
environment arrays are both loaded.

```dotenv
IMAP_SERVERS='[{"id":"archive","name":"Archive","host":"imap.example.net","port":993,"secure":true,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","mailbox":"INBOX","pollSeconds":30}]'
```

### Outgoing mail

The primary sender likewise requires host, username, and password together.

| Item                               | Setting name                                      | Environment variable             | Default or requirement                             |
| ---------------------------------- | ------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Host                               | `Settings > SMTP > Host`                          | `SMTP_HOST`                      | Required.                                          |
| Port                               | `Settings > SMTP > Port`                          | `SMTP_PORT`                      | `587`.                                             |
| Username                           | `Settings > SMTP > Username / Email`              | `SMTP_USER`                      | Required.                                          |
| Password                           | `Settings > SMTP > Password`                      | `SMTP_PASSWORD`                  | Required.                                          |
| Implicit TLS                       | `Settings > SMTP > TLS / SSL`                     | `SMTP_SECURE`                    | `false`; port 587 commonly upgrades with STARTTLS. |
| Certificate verification exception | `Settings > SMTP > Allow self-signed certificate` | `SMTP_ALLOW_INVALID_CERTIFICATE` | `false`; enable only for a trusted private server. |
| From address                       | `Settings > SMTP > From address`                  | `SMTP_FROM`                      | SMTP username when empty.                          |
| Undo send                          | `Settings > SMTP > Undo send delay`               | `SMTP_UNDO_SEND_SECONDS`         | `0`; accepted range is 0 through 30 seconds.       |
| Additional senders                 | `Settings > SMTP > Secondary SMTP servers`        | `SMTP_SERVERS`                   | Optional JSON array.                               |

Each `SMTP_SERVERS` object supports `id`, `name`, `host`, `port`, `secure`,
`allowInvalidCertificate`, `user`, `password`, and `from`.

```dotenv
SMTP_SERVERS='[{"id":"archive","name":"Archive","host":"smtp.example.net","port":587,"secure":false,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","from":"Archive <archive@example.net>"}]'
```

### Shared process requirements

| Item                      | Setting name | Environment variable | Requirement                                                                        |
| ------------------------- | ------------ | -------------------- | ---------------------------------------------------------------------------------- |
| Shared state and queues   | None         | `DATABASE_URL`       | Required outside demo mode and must identify the same database for web and worker. |
| Saved password encryption | None         | `MAIL_SECRET_KEY`    | Strongly recommended and must match across processes.                              |
| Mail processing           | None         | None                 | A worker process must remain running.                                              |

Changing the primary IMAP host or username clears that account's local sync state so it can be
rebuilt safely. Use **Test connection** before relying on a new account.

## Public IMAP proxy

The worker can expose a transparent TCP listener for one account. This is disabled by default and
uses worker-only environment values. See [Public IMAP proxy](/features/imap-proxy) for its exact
variables and network security requirements.
