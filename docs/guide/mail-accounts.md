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

## Environment configuration

Settings are recommended because they support multiple accounts and can be changed without editing
deployment files. Environment variables remain useful as a deployment fallback.

The legacy `IMAP_*` and `SMTP_*` variables define a primary account. Additional accounts can be
provided as JSON arrays:

```dotenv
IMAP_SERVERS='[{"id":"archive","name":"Archive","host":"imap.example.net","port":993,"secure":true,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","mailbox":"INBOX","pollSeconds":30}]'

SMTP_SERVERS='[{"id":"archive","name":"Archive","host":"smtp.example.net","port":587,"secure":false,"allowInvalidCertificate":false,"user":"archive@example.net","password":"secret","from":"Archive <archive@example.net>"}]'
```

See the [configuration reference](/reference/configuration) for defaults and precedence.

## Public IMAP proxy

The worker can expose a transparent TCP proxy to one configured IMAP account. Set
`IMAP_PUBLIC_PORT` to enable it, `IMAP_PUBLIC_CONFIG_ID` to choose the account, and
`IMAP_PUBLIC_HOST` to choose the listen address.

Authentication is still performed by the upstream IMAP server. The proxy does not create a separate
mail account or access policy. It listens on `127.0.0.1` by default; exposing it on `0.0.0.0` requires
appropriate firewall and network controls.
