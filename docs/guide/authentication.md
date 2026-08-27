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

At least one working login method must remain available. Settings rejects provider changes that
would lock out the owner.

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
The issuer and `sub` claim form the stable provider identity for the linked owner account.

OIDC endpoints must use HTTPS, except for localhost development. `OIDC_DISCOVERY_URL` remains only as
a compatibility fallback for existing installations.

## Passkeys

Passkeys can be enrolled in Settings after the first sign-in. Production passkeys require HTTPS and
an `ORIGIN` whose hostname matches the site users open. Keep another working authentication method
until a newly enrolled passkey has been tested.

## Passwords and sessions

The owner can enable or change password login under **Settings > Authentication**. Passwords must be
8 through 128 characters. The **Settings > Sessions** page lists active devices, creation and expiry
times, last activity, IP addresses, and user agents. Any session can be revoked; revoking the current
session signs out that browser.

## Secrets

`BETTER_AUTH_SECRET` signs authentication data and must be a high-entropy production secret.
`MAIL_SECRET_KEY` encrypts secrets stored in PostgreSQL, including mail passwords, provider client
secrets, the OpenAI key, and OpenPGP private keys.

Use different values for these variables. Every web and worker instance that reads encrypted data
must receive the same `MAIL_SECRET_KEY`. Back up the key outside PostgreSQL.

Settings saved before `MAIL_SECRET_KEY` is configured remain readable as plaintext for migration,
but new OpenPGP private-key generation and import are disabled until the key is present.

## Configuration

### Core authentication

| Item                       | Setting name                                                                        | Environment variable | Requirement                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Public application URL     | None                                                                                | `ORIGIN`             | Required outside demo mode. Use the exact scheme, hostname, and non-standard port.                                             |
| Authentication signing     | None                                                                                | `BETTER_AUTH_SECRET` | Required outside demo mode on the web process. Use an independent, high-entropy value of at least 32 characters in production. |
| Provider-secret encryption | None                                                                                | `MAIL_SECRET_KEY`    | Strongly recommended before saving provider secrets. Keep it stable and back it up.                                            |
| Authentication records     | None                                                                                | `DATABASE_URL`       | Required outside demo mode.                                                                                                    |
| Password login             | `Setup > Email and password` or `Settings > Authentication > Enable password login` | None                 | One login method is required; password login itself is optional.                                                               |
| Passkey login              | `Settings > Authentication > Passkeys`                                              | None                 | Optional after the first sign-in; requires a matching HTTPS origin in production.                                              |
| Session revocation         | `Settings > Sessions`                                                               | None                 | No additional configuration.                                                                                                   |

### GitHub and Discord

Each provider requires both values from either Settings or the environment.

| Provider | Setting names                                                               | Environment variables                           | Requirement                                                   |
| -------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| GitHub   | `Settings > Authentication > GitHub OAuth > Client ID` and `Client Secret`  | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`   | Optional pair. Register `<ORIGIN>/api/auth/callback/github`.  |
| Discord  | `Settings > Authentication > Discord OAuth > Client ID` and `Client Secret` | `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` | Optional pair. Register `<ORIGIN>/api/auth/callback/discord`. |

### OpenID Connect

New OIDC setups require all six visible fields. A saved value takes precedence over its environment
fallback.

| Setting name                                          | Environment variable     | Requirement                                                          |
| ----------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `Settings > Authentication > OpenID Connect > Issuer` | `OIDC_ISSUER`            | Required for a new OIDC configuration.                               |
| `Authorization URL`                                   | `OIDC_AUTHORIZATION_URL` | Required for a new OIDC configuration.                               |
| `Token URL`                                           | `OIDC_TOKEN_URL`         | Required for a new OIDC configuration.                               |
| `User info URL`                                       | `OIDC_USER_INFO_URL`     | Required for a new OIDC configuration.                               |
| `Client ID`                                           | `OIDC_CLIENT_ID`         | Required for a new OIDC configuration.                               |
| `Client Secret`                                       | `OIDC_CLIENT_SECRET`     | Required for a new OIDC configuration.                               |
| No current Settings field                             | `OIDC_DISCOVERY_URL`     | Deprecated fallback only for existing discovery-based installations. |

Changing an OIDC issuer removes the existing OIDC account link. Save the new complete configuration,
then link the owner's account again while another login method is still available.
