# External API and MCP

Each configured mail installation serves interactive integration documentation at
`<ORIGIN>/api-docs`. The page uses the installation's current origin in copyable examples.

## Authentication

Create an API key under **Settings > API Keys**. The plaintext key is displayed once and begins with
`pmail_`. Send it as a Bearer token:

```http
Authorization: Bearer pmail_your_api_key
```

API keys belong to the single owner and have read and send access. Store keys as secrets and revoke
unused keys from Settings. The external API is unavailable in demo mode.

## Configuration

| Item              | Setting name                                                 | Environment variable                                             | Requirement                                                                   |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Client credential | `Settings > API Keys > Key name` and `Create key`            | None                                                             | Required. Copy the `pmail_` key when issued; it is shown once.                |
| Public base URL   | None                                                         | `ORIGIN`                                                         | Required for canonical examples and clients connecting from outside the host. |
| API availability  | None                                                         | `DEMO_MODE`                                                      | Must be unset or `false`; the external API is disabled in demo mode.          |
| Read operations   | `Settings > IMAP > Host`, `Username / Email`, and `Password` | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | Synchronized mail is required for useful read results.                        |
| Send operations   | `Settings > SMTP > Host`, `Username / Email`, and `Password` | `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`, or `SMTP_SERVERS` | A complete SMTP sender and running worker are required.                       |

There is no separate environment variable for an API key. Keys are generated in Settings, stored as
scrypt hashes, and can be revoked individually.

## REST API

The REST base URL is `<ORIGIN>/api/external/v1`. Available operations include:

| Method | Path               | Purpose                                               |
| ------ | ------------------ | ----------------------------------------------------- |
| `GET`  | `/mailboxes`       | List selectable mailboxes and slugs.                  |
| `GET`  | `/messages`        | List or search received messages.                     |
| `GET`  | `/messages/:id`    | Read one message and its attachment metadata.         |
| `POST` | `/messages`        | Queue an outgoing message and return an operation ID. |
| `GET`  | `/send-jobs/:id`   | Read outgoing operation status.                       |
| `GET`  | `/attachments/:id` | Download a message attachment.                        |

Refer to the running `/api-docs` page for query parameters and current request examples.

## MCP

The same integration exposes `list_messages`, `get_message`, and `send_message` as MCP tools.
Standard clients should use the HTTP endpoint at `/api/external/v1/mcp`. A legacy HTTP+SSE
transport is available at `/api/external/v1/mcp/sse`.

The production Node server also provides a WebSocket extension at
`/api/external/v1/mcp/ws`. Connect with the `mcp` subprotocol and the API key as a second subprotocol.
Prefer HTTP or SSE for clients that expect standard MCP transports.

Requests are rate limited. A limited client should honor HTTP `429` and the `Retry-After` header.
