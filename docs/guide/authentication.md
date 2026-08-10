# Authentication

mail is intentionally a single-user application. Authentication protects one owner account; it is
not a multi-user mail host.

## First-time setup

The initial `/setup` screen requires at least one of these methods:

- Email and password
- GitHub OAuth
- Discord OAuth
- OpenID Connect (OIDC)

The password flow creates the owner immediately. If setup uses only an external provider, the first
successful provider login claims the installation. Once an owner exists, another account cannot
sign up through a configured provider.

Additional providers must be linked by the authenticated owner from Settings. Provider accounts are
not linked implicitly, even when they return the same email address.

## Provider callback URLs

Set `ORIGIN` to the exact public, scheme-qualified origin before registering OAuth clients. Use these
callback URLs:

| Provider       | Callback URL                             |
| -------------- | ---------------------------------------- |
| GitHub         | `<ORIGIN>/api/auth/callback/github`      |
| Discord        | `<ORIGIN>/api/auth/callback/discord`     |
| OpenID Connect | `<ORIGIN>/api/auth/oauth2/callback/oidc` |

Changing the scheme, hostname, or port changes both the callback URL and the passkey relying-party
identity. Avoid changing `ORIGIN` after enrolling passkeys.

## OpenID Connect

New OIDC configurations use explicit values for the issuer, authorization endpoint, token endpoint,
user-info endpoint, client ID, and client secret. All values are required. The provider must return
`sub`, `email`, and `name` claims, and the client requests the `openid`, `profile`, and `email` scopes.

OIDC endpoints must use HTTPS, except for localhost development. `OIDC_DISCOVERY_URL` remains only as
a compatibility fallback for existing installations.

## Passkeys

Passkeys can be enrolled in Settings after the first sign-in. Production passkeys require HTTPS and
an `ORIGIN` whose hostname matches the site users open. Keep another working authentication method
until a newly enrolled passkey has been tested.

## Secrets

`BETTER_AUTH_SECRET` signs authentication data and must be a high-entropy production secret.
`MAIL_SECRET_KEY` encrypts secrets stored in PostgreSQL, including mail passwords, provider client
secrets, the OpenAI key, and OpenPGP private keys.

Use different values for these variables. Every web and worker instance that reads encrypted data
must receive the same `MAIL_SECRET_KEY`. Back up the key outside PostgreSQL.

Settings saved before `MAIL_SECRET_KEY` is configured remain readable as plaintext for migration,
but new OpenPGP private-key generation and import are disabled until the key is present.
