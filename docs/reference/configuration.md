# Configuration

mail reads runtime configuration from environment variables and stores editable application settings
in PostgreSQL. `.env.example` documents the web runtime, while `.env.example.worker` is a smaller
template for separately managed workers.

## Precedence

Non-empty values saved through setup or Settings take precedence over scalar authentication, AI,
IMAP, and SMTP environment variables. Environment variables remain fallbacks. Additional IMAP and
SMTP server arrays from PostgreSQL and the environment are both loaded.

Core process settings such as `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, and
`MAIL_SECRET_KEY` are environment-only. Settings caches refresh within a few seconds after changes.

Boolean mail settings use `false` to disable a value; other non-empty values enable it.

## Core settings

| Variable             | Process     | Default | Description                                                                                                                                    |
| -------------------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | web, worker | none    | PostgreSQL connection URL. Required outside demo mode.                                                                                         |
| `ORIGIN`             | web, worker | none    | Exact public origin, including scheme and port when non-standard. Used by authentication, passkeys, callbacks, and tracking links.             |
| `BETTER_AUTH_SECRET` | web         | none    | High-entropy authentication signing secret. Use at least 32 characters in production.                                                          |
| `MAIL_SECRET_KEY`    | web, worker | empty   | Encrypts stored mail passwords, provider secrets, OpenAI credentials, and OpenPGP private keys. Must match across processes and remain stable. |
| `DEMO_MODE`          | web, worker | `false` | Uses in-memory demo data and disables external services. Accepts `1`, `true`, `yes`, or `on`.                                                  |

## PostgreSQL

| Variable                     | Default | Description                                                                                                                                   |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PG_POOL_MAX`                | `10`    | Maximum connections for each process. The worker example recommends `5`.                                                                      |
| `PG_TLS_REJECT_UNAUTHORIZED` | `true`  | Set to `false` only for a trusted PostgreSQL server with a private or self-signed certificate. This does not affect HTTPS, IMAP, or SMTP TLS. |

## Web runtime and attachments

| Variable                        | Default                   | Description                                                                          |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `HOST`                          | `0.0.0.0`                 | Address used by the production Node server.                                          |
| `PORT`                          | `3000`                    | Port used by the production Node server.                                             |
| `BODY_SIZE_LIMIT`               | `Infinity`                | SvelteKit request-body limit. Accepts a byte count or a value with `K`, `M`, or `G`. |
| `PUBLIC_ATTACHMENT_DIR`         | `data/public-attachments` | Persistent directory for streamed public-link attachments.                           |
| `PUBLIC_ATTACHMENT_MAX_BYTES`   | `104857600`               | Maximum size of one public attachment, in bytes (100 MiB).                           |
| `PUBLIC_ATTACHMENT_TOTAL_BYTES` | `2147483648`              | Total active public-attachment quota, in bytes (2 GiB).                              |
| `NODE_ENV`                      | unset                     | Set to `production` in production. Container images set it automatically.            |

Public links expire after 30 days. Configure the reverse proxy body-size limit to be at least
`PUBLIC_ATTACHMENT_MAX_BYTES`, and include the attachment directory in backups.

## Authentication providers

Provider settings can be supplied during setup or changed later in Settings.

| Variable                 | Default | Description                                                        |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `GITHUB_CLIENT_ID`       | empty   | GitHub OAuth application client ID.                                |
| `GITHUB_CLIENT_SECRET`   | empty   | GitHub OAuth application client secret.                            |
| `DISCORD_CLIENT_ID`      | empty   | Discord OAuth application client ID.                               |
| `DISCORD_CLIENT_SECRET`  | empty   | Discord OAuth application client secret.                           |
| `OIDC_ISSUER`            | empty   | OIDC issuer identifier.                                            |
| `OIDC_AUTHORIZATION_URL` | empty   | OIDC authorization endpoint.                                       |
| `OIDC_TOKEN_URL`         | empty   | OIDC token endpoint.                                               |
| `OIDC_USER_INFO_URL`     | empty   | OIDC user-info endpoint.                                           |
| `OIDC_CLIENT_ID`         | empty   | OIDC client ID.                                                    |
| `OIDC_CLIENT_SECRET`     | empty   | OIDC client secret.                                                |
| `OIDC_DISCOVERY_URL`     | empty   | Deprecated discovery-document fallback for existing installations. |

If any manual OIDC endpoint is configured, all four endpoint variables plus the client ID and secret
are required. See [Authentication](/guide/authentication) for callback URLs and ownership behavior.

## AI and mail authentication

| Variable                           | Default        | Description                                                                                                                                  |
| ---------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                   | empty          | Enables AI-backed features. Can also be stored through Settings.                                                                             |
| `OPENAI_MODEL`                     | `gpt-4.1-mini` | Model used for AI operations.                                                                                                                |
| `OPENAI_IMPORTANCE_CLASSIFICATION` | `true`         | Set to `false` to keep on-demand AI features without automatically classifying incoming mail.                                                |
| `MAIL_AUTH_TRUSTED_AUTHSERV_IDS`   | empty          | Comma-separated trusted Authentication-Results `authserv-id` values. A `*.` prefix matches subdomains. Keep this identical across processes. |

Incoming mail content is sent to the configured OpenAI model when automatic importance
classification is enabled.

## IMAP

The primary environment account is created only when host, user, and password are all present.

| Variable                         | Default | Description                                                                               |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `IMAP_HOST`                      | empty   | Primary IMAP hostname.                                                                    |
| `IMAP_PORT`                      | `993`   | Primary IMAP port.                                                                        |
| `IMAP_SECURE`                    | `true`  | Enables implicit TLS.                                                                     |
| `IMAP_ALLOW_INVALID_CERTIFICATE` | `false` | Disables certificate verification for this server. Use only on a trusted private network. |
| `IMAP_USER`                      | empty   | Primary IMAP username.                                                                    |
| `IMAP_PASSWORD`                  | empty   | Primary IMAP password.                                                                    |
| `IMAP_MAILBOX`                   | `INBOX` | Initial mailbox.                                                                          |
| `IMAP_POLL_SECONDS`              | `15`    | Poll interval in seconds.                                                                 |
| `IMAP_SERVERS`                   | `[]`    | JSON array of additional account objects. Invalid JSON is ignored.                        |

Each `IMAP_SERVERS` object supports `id`, `name`, `host`, `port`, `secure`,
`allowInvalidCertificate`, `user`, `password`, `mailbox`, and `pollSeconds`.

```dotenv
IMAP_SERVERS='[{"id":"archive","name":"Archive","host":"imap.example.net","port":993,"secure":true,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","mailbox":"INBOX","pollSeconds":30}]'
```

## SMTP

The primary environment sender is created only when host, user, and password are all present.

| Variable                         | Default     | Description                                                                                   |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                      | empty       | Primary SMTP hostname.                                                                        |
| `SMTP_PORT`                      | `587`       | Primary SMTP port.                                                                            |
| `SMTP_SECURE`                    | `false`     | Enables implicit TLS. Port `587` commonly uses STARTTLS instead.                              |
| `SMTP_ALLOW_INVALID_CERTIFICATE` | `false`     | Disables certificate verification for this server. Use only on a trusted private network.     |
| `SMTP_USER`                      | empty       | Primary SMTP username.                                                                        |
| `SMTP_PASSWORD`                  | empty       | Primary SMTP password.                                                                        |
| `SMTP_FROM`                      | `SMTP_USER` | Default From address.                                                                         |
| `SMTP_UNDO_SEND_SECONDS`         | `0`         | Delay before queued mail is sent. Values are truncated and clamped from 0 through 30 seconds. |
| `SMTP_SERVERS`                   | `[]`        | JSON array of additional sender objects. Invalid JSON is ignored.                             |

Each `SMTP_SERVERS` object supports `id`, `name`, `host`, `port`, `secure`,
`allowInvalidCertificate`, `user`, `password`, and `from`.

```dotenv
SMTP_SERVERS='[{"id":"archive","name":"Archive","host":"smtp.example.net","port":587,"secure":false,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","from":"Archive <archive@example.net>"}]'
```

## Public IMAP proxy

These worker-only values expose a transparent TCP proxy to one configured IMAP account. Leave
`IMAP_PUBLIC_PORT` unset to disable it.

| Variable                | Default     | Description                                                                         |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `IMAP_PUBLIC_PORT`      | unset       | Listen port from 1 through 65535. Setting it enables the proxy.                     |
| `IMAP_PUBLIC_HOST`      | `127.0.0.1` | Listen address. Use `0.0.0.0` only when network access is intentionally controlled. |
| `IMAP_PUBLIC_CONFIG_ID` | `primary`   | ID of the IMAP configuration to proxy.                                              |
