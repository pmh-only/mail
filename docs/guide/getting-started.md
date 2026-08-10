# Getting started

This guide runs mail from source for local use. For a long-running installation, continue with the
[deployment guide](/operations/deployment).

## Requirements

- Node.js 22 or newer
- pnpm 10 (the repository pins the expected version in `package.json`)
- PostgreSQL
- An IMAP account for receiving mail
- An SMTP account for sending mail

IMAP and SMTP are optional during first-time setup, but the worker cannot synchronize or send mail
until they are configured.

## Install

```sh
git clone https://github.com/pmh-only/mail.git
cd mail
corepack enable
pnpm install
cp .env.example .env
```

Create an empty PostgreSQL database, then set at least these values in `.env`:

```dotenv
DATABASE_URL="postgresql://mail:password@localhost:5432/mail"
ORIGIN="http://localhost:5173"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
MAIL_SECRET_KEY="replace-with-a-separate-long-random-secret"
```

Generate independent secrets with `openssl rand -base64 32`. Keep `MAIL_SECRET_KEY` stable: data
encrypted with that key cannot be recovered after the key is lost or changed.

The example file uses port `3000` for a production/container runtime. SvelteKit development uses
port `5173` by default, so update `ORIGIN` as shown above when running from source.

## Start the application

```sh
pnpm dev
```

This starts the web and worker development processes together. Open `http://localhost:5173`. The
application runs database migrations automatically before serving requests or processing jobs.

On the first visit, mail redirects to `/setup`. Configure at least one login method and, optionally,
the first IMAP and SMTP account. Additional accounts and features can be configured later in
Settings.

## Run without external services

Demo mode uses in-memory sample data and does not require PostgreSQL, authentication, IMAP, SMTP, or
the worker:

```sh
DEMO_MODE=true pnpm dev
```

Demo data resets whenever the web process restarts. The external API is disabled in demo mode.

## Next steps

- Review [authentication](/guide/authentication) before exposing the application publicly.
- Add and troubleshoot [mail accounts](/guide/mail-accounts).
- Read the complete [configuration reference](/reference/configuration).
- Follow the [deployment guide](/operations/deployment) for containers, persistence, and backups.
