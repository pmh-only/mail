# AGENTS.md / CLAUDE.md

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: oxfmt, oxlint, tailwindcss, drizzle, better-auth

## Overview

`mail` is a self-hosted, single-user webmail client built on SvelteKit (SSR-first). It talks to any
IMAP/SMTP account, stores synced mail in PostgreSQL via Drizzle ORM, and layers on OpenPGP
(cleartext/detached/PGP-MIME sign, encrypt, verify, decrypt), AI features backed by the OpenAI API,
and authentication via better-auth (password, passkey, GitHub, Discord, OIDC). The app runs as two
processes: a **web** process (SvelteKit adapter-node, `server.js`) and a **worker** process
(`src/worker.ts`, built separately to `build-worker/worker.js`) that owns IMAP sync, SMTP sending,
and other background jobs so they never block HTTP requests. `DEMO_MODE` runs the whole app against
in-memory sample data with no database, mail server, or auth provider required.

## Commands

```sh
pnpm dev                                        # run web + worker together for local development
pnpm build                                      # build:web && build:worker
pnpm check                                      # svelte-kit sync + svelte-check type checking
pnpm test                                       # DEMO_MODE=true vitest run
pnpm test:coverage                              # vitest run --coverage (100% thresholds enforced)
pnpm exec vitest run path/to/foo.test.ts        # run a single test file
pnpm exec vitest run path/to/foo.test.ts -t "name"   # run a single test by name
pnpm lint                                       # oxfmt --check . && oxlint --deny-warnings
pnpm format                                     # oxfmt --write .
pnpm db:generate / db:push / db:migrate / db:studio   # drizzle-kit
```

## Architecture

- `src/hooks.server.ts` — single entry point for every web request: runs DB migrations and warm-up
  once at boot, wires better-auth (`svelteKitHandler`), enforces which paths are public vs. authed,
  and gates external API / demo-mode behavior.
- `src/worker.ts` — a standalone polling loop (not request-driven) that dispatches IMAP sync,
  SMTP sending, cleanup rules, AI importance classification, push-notification delivery, and the
  public IMAP proxy. Web and worker both import the same `src/lib/server/*` modules, so business
  logic lives there rather than in either entry point.
- `src/lib/server/` — server-only domain logic shared by web routes and the worker: `mail.ts`
  (mailbox/thread storage), `imap-connections.ts` / `imap-worker.ts` (IMAP sync + job queue),
  `smtp-worker.ts` (outgoing mail job queue), `openpgp-*.ts` (crypto), `filters.ts` /
  `cleanup-rules.ts` (mail automation), `auth.ts` / `auth-owner.ts` (better-auth + single-owner
  model), `config.ts` (env vs. DB-stored settings precedence — DB settings from the setup/Settings
  UI win over env vars).
- `src/lib/server/db/` — Drizzle schema (`schema.pg.ts`, `auth.schema.pg.ts`, re-exported through
  `schema.ts`) and the Postgres connection/migration runner (`index.ts`); SQL migrations live in the
  top-level `drizzle/` directory.
- `src/routes/` — SvelteKit pages and API endpoints. The `(authed)/` group holds logged-in pages
  (`[mailbox]/[id]` for reading mail, `settings`, `contacts`, `operations`, `audit-log`); `api/`
  holds `+server.ts` JSON endpoints mirroring the same domains (`messages`, `threads`, `filters`,
  `ai/*`, `external/v1` public API, `push`, `openpgp`); a handful of routes are intentionally public
  (`/login`, `/setup`, `/share/[token]`, `/attachments/[token]`, `/email-open/[token]` tracking pixel).

## Code Structure

- `src/lib/*.ts` / `*.svelte.ts` — shared client+server utilities (mailbox state, search, filters,
  theme, push, keyboard shortcuts, etc.), each usually colocated with its `*.test.ts`.
- `src/lib/server/` — server-only logic (see Architecture above); never imported from client code.
- `src/lib/components/` — Svelte UI components; `components/ui/` holds shadcn-svelte-style primitives.
- `src/routes/` — pages and API endpoints (see Architecture above).
- `drizzle/` — generated SQL migrations (via `pnpm db:generate`).
- `scripts/` — dev/build orchestration, e.g. `scripts/dev.mjs` spawns the web and worker dev servers.
- `static/` — static assets served as-is.

## Test Structure

- Tests run on Vitest, configured in `vite.config.ts`: `environment: 'node'`, `fileParallelism: false`,
  and v8 coverage with 100% statement/branch/function/line thresholds (enforced by the `pre-commit`
  hook and `pnpm test:coverage`).
- Tests are colocated with the code they cover: `foo.ts` → `foo.test.ts` in the same directory.
  Drizzle schema files are validated in `schema.pg.test.ts` / `auth.schema.pg.test.ts`; a couple of
  server modules with heavy mocking use a `*.unit.test.ts` suffix (e.g. `openpgp-message.unit.test.ts`).
- `pnpm test` always sets `DEMO_MODE=true`, so tests exercise the in-memory demo code paths
  (`src/lib/server/demo.ts`) rather than requiring a live PostgreSQL, IMAP, or SMTP server; external
  services (OpenPGP, OpenAI, IMAP/SMTP clients) are mocked at their module boundary with `vi.mock`.

## Git Hooks

Husky manages the Git hooks in `.husky/`.
Always confirm Husky is the active hook manager before starting work, and restore it if it is not:

```sh
git config --get core.hooksPath   # must print .husky/_
pnpm exec husky                   # re-installs it when missing or pointing elsewhere
```

Never commit with `--no-verify`, and never repoint `core.hooksPath` away from `.husky/_`.

## Commits

All commits must follow the Conventional Commits format and include a brief description.
For the braking changes including api change or require full mailbox re-sync must include `!` mark like `feat(something)!:`
Use only `fix`, `feat`, `docs` and `chore`. Always include scope in commit message.

Before committing, formatting, linting, tests, coverage checks, type checks, and builds must succeed.
Coverage must stay at 100% for statements, branches, functions, and lines; the `pre-commit` hook fails below that.

## Pull Requests

All agents must complete the pull request template when creating a pull request.
The pull request title must match the primary commit message.
Pull requests must contain only user-requested changes and exclude personal environment changes.
