# Public IMAP proxy

The worker can expose a transparent TCP proxy to one configured IMAP account. It is intended for
controlled network layouts where another client needs a stable listener that forwards to the
selected upstream host and port.

The proxy forwards bytes in both directions. It does not inject credentials, create a separate user,
terminate TLS, or add an access policy. Authentication and any implicit TLS negotiation are still
performed by the upstream IMAP server through the forwarded connection.

## Security

The listener binds to loopback by default. Keep it behind a firewall, private network, authenticated
tunnel, or equivalent control. Binding to `0.0.0.0` can expose the upstream IMAP service to any
network that can reach the worker. The proxy supports up to 100 concurrent connections and closes
idle connections after five minutes.

## Configuration

These values are worker-only and environment-only.

| Item                 | Setting name                                                 | Environment variable                                             | Requirement                                                                    |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Enable listener      | None                                                         | `IMAP_PUBLIC_PORT`                                               | Required to enable the proxy; integer from 1 through 65535. Unset disables it. |
| Listen address       | None                                                         | `IMAP_PUBLIC_HOST`                                               | Optional; defaults to `127.0.0.1`.                                             |
| Upstream account     | None                                                         | `IMAP_PUBLIC_CONFIG_ID`                                          | Optional; defaults to `primary` and must match a configured IMAP account ID.   |
| Upstream IMAP server | `Settings > IMAP > Host`, `Username / Email`, and `Password` | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | A complete account matching the selected ID is required.                       |

The proxy starts and stops with the worker. It is not available from a web-only deployment or demo
mode.
