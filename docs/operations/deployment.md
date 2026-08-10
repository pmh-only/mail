# Deployment

A production deployment needs PostgreSQL plus two application processes built from the same mail
release.

```text
browser -> reverse proxy -> web process -> PostgreSQL
                                  ^
                                  |
IMAP/SMTP providers <- worker process
                         |
                         +-------------> PostgreSQL
```

The web process serves SvelteKit and queues background operations. The worker synchronizes IMAP,
sends SMTP messages, runs cleanup rules, classifies mail, and dispatches notifications. Do not omit
the worker from a production installation.

## Prepare configuration

Copy `.env.example` to `.env` and configure at least:

```dotenv
DATABASE_URL="postgresql://mail:password@database.example.com:5432/mail"
ORIGIN="https://mail.example.com"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
MAIL_SECRET_KEY="replace-with-a-separate-long-random-secret"
```

The database must be reachable from both processes. Give both processes the same `DATABASE_URL`,
`ORIGIN`, and `MAIL_SECRET_KEY`. Provider, AI, IMAP, and SMTP settings can instead be entered through
the setup and Settings screens.

## Docker Compose

The repository Compose file builds both images locally and stores public-link attachments in a named
volume. It expects PostgreSQL to be provided separately through `DATABASE_URL`.

```sh
cp .env.example .env
# Edit .env before starting the services.
docker compose up --build -d
docker compose logs -f web worker
```

The application is available on port `3000`. Database migrations run automatically at startup.

## Prebuilt containers

Multi-architecture web and worker images are published to GitHub Container Registry:

- `ghcr.io/pmh-only/mail`
- `ghcr.io/pmh-only/mail-worker`

The `latest` tag follows the main branch. Prefer a release tag for production so upgrades are
intentional.

```sh
docker volume create mail-public-attachments

docker run -d \
  --name mail-web \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v mail-public-attachments:/app/data/public-attachments \
  ghcr.io/pmh-only/mail:latest

docker run -d \
  --name mail-worker \
  --restart unless-stopped \
  --env-file .env \
  ghcr.io/pmh-only/mail-worker:latest
```

Your `DATABASE_URL` hostname must be resolvable from both containers. Use a Docker network when the
database also runs in a container.

## Reverse proxy

Terminate HTTPS in front of the web process and preserve the original host and protocol headers.
`ORIGIN` must exactly match the public URL.

Configure the proxy to:

- Forward ordinary HTTP traffic to port `3000`.
- Support WebSocket upgrades for `/api/external/v1/mcp/ws` if that transport is used.
- Accept request bodies up to the configured public-attachment limit.
- Use timeouts that permit large streamed attachment uploads.

Passkeys and most external authentication providers require HTTPS in production.

## Persistent data

Back up these items together:

- The PostgreSQL database
- The directory configured by `PUBLIC_ATTACHMENT_DIR`
- `MAIL_SECRET_KEY` and other deployment secrets

PostgreSQL contains synchronized messages, settings, encrypted credentials, jobs, authentication
records, and OpenPGP keys. Public-link attachment bytes are stored on disk, with their metadata in
PostgreSQL. A database-only backup is incomplete when public attachments are in use.

## Upgrade

1. Read the release notes and pin the target version.
2. Back up PostgreSQL, public attachment files, and secrets.
3. Pull or build both images from the same release.
4. Restart the web and worker processes.
5. Confirm the worker heartbeat and mailbox sync status in the application.

Migrations are automatic and can be run by either process. Never rotate `MAIL_SECRET_KEY` as part of
a routine upgrade; changing it makes existing encrypted values unreadable.
