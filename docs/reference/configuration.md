# Configuration

mail uses environment variables for process-level configuration and PostgreSQL for values saved
through setup or Settings. Feature-specific setting and environment names live with the feature
they control instead of in one global variable catalog.

## Configuration files

- `.env.example` is the web-process template and includes optional feature fallbacks.
- `.env.example.worker` is a smaller template for a separately managed worker.
- A shared `.env` can be supplied to both processes, as in the repository's Docker Compose file.

Do not commit populated environment files. Give web and worker only the values each process needs.

## Precedence

Non-empty values saved through setup or Settings take precedence over scalar authentication, AI,
IMAP, and SMTP environment variables. Environment variables remain fallbacks. Additional IMAP and
SMTP arrays saved in PostgreSQL and supplied through the environment are both loaded.

`DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, and `MAIL_SECRET_KEY` are environment-only. The
settings cache refreshes within about five seconds after a change. Boolean mail fallbacks use the
string `false` to disable a value; other non-empty values enable it.

## Core process settings

| Variable             | Process     | Default | Requirement                                                                                                                           |
| -------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | web, worker | none    | PostgreSQL connection URL. Required outside [demo mode](/features/demo-mode). Both processes must use the same database.              |
| `ORIGIN`             | web, worker | none    | Exact public HTTP or HTTPS origin, including a non-standard port. Required for authentication and used by tracking and callback URLs. |
| `BETTER_AUTH_SECRET` | web         | none    | Required outside demo mode. Use an independent high-entropy value of at least 32 characters in production.                            |
| `MAIL_SECRET_KEY`    | web, worker | empty   | Encrypts stored credentials and private keys. Keep it stable, identical across processes, and backed up.                              |
| `DEMO_MODE`          | web, worker | `false` | Accepts `1`, `true`, `yes`, or `on`; see [Demo mode](/features/demo-mode).                                                            |

Generate independent secrets with `openssl rand -base64 32`. Losing or changing `MAIL_SECRET_KEY`
makes values already encrypted with it unreadable.

## Runtime tuning

| Variable                     | Process     | Default      | Description                                                                                                                                 |
| ---------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `PG_POOL_MAX`                | web, worker | `10`         | Maximum PostgreSQL connections per process. The worker example uses `5`.                                                                    |
| `PG_TLS_REJECT_UNAUTHORIZED` | web, worker | `true`       | Set to `false` only for a trusted PostgreSQL server with a private or self-signed certificate. It does not affect HTTPS, IMAP, or SMTP.     |
| `HOST`                       | web         | `0.0.0.0`    | Production Node server listen address.                                                                                                      |
| `PORT`                       | web         | `3000`       | Production Node server listen port.                                                                                                         |
| `BODY_SIZE_LIMIT`            | web         | `Infinity`   | SvelteKit request-body limit. Accepts bytes or a value with `K`, `M`, or `G`. See [Composing and sending](/features/composing-and-sending). |
| `NODE_ENV`                   | web, worker | unset        | Set to `production` for production source deployments. Container images set it automatically.                                               |
| `TZ`                         | worker      | `Asia/Seoul` | Timezone used only when formatting an IMAP cooldown timestamp in worker logs.                                                               |

## Feature configuration

Use the relevant feature page for exact Settings labels, environment names, defaults, and
requirements:

| Feature                                          | Configuration page                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| IMAP and SMTP accounts                           | [Mail accounts](/guide/mail-accounts#configuration)                    |
| Authentication providers, passkeys, and sessions | [Authentication](/guide/authentication#configuration)                  |
| AI and automatic importance                      | [AI features](/features/ai#configuration)                              |
| Public-link and direct attachments               | [Composing and sending](/features/composing-and-sending#configuration) |
| OpenPGP private-key storage                      | [OpenPGP](/features/openpgp#configuration)                             |
| Remote-content privacy                           | [Privacy controls](/features/privacy#configuration)                    |
| SPF, DKIM, and DMARC trust                       | [Mail authentication](/features/mail-authentication#configuration)     |
| Push and quiet hours                             | [Push notifications](/features/notifications#configuration)            |
| Outgoing read tracking                           | [Read tracking](/features/read-tracking#configuration)                 |
| Public IMAP listener                             | [Public IMAP proxy](/features/imap-proxy#configuration)                |
| REST API and MCP                                 | [External API and MCP](/reference/api#configuration)                   |

The [feature overview](/features/) links every feature page, including features with Settings-only
configuration and no environment variable.
