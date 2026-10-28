# Development

## Set up the repository

```sh
git clone https://github.com/pmh-only/mail.git
cd mail
corepack enable
pnpm install
cp .env.example .env
```

Use a local PostgreSQL database for application development, or set `DEMO_MODE=true` when working on
code paths supported by the in-memory demo.

## Commands

| Command              | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `pnpm dev`           | Run the web and worker development processes together. |
| `pnpm build`         | Build the production web and worker bundles.           |
| `pnpm check`         | Run Svelte and TypeScript checks.                      |
| `pnpm test`          | Run the Vitest suite in demo mode.                     |
| `pnpm test:coverage` | Run tests with enforced 100% coverage thresholds.      |
| `pnpm lint`          | Check formatting and run Oxlint with warnings denied.  |
| `pnpm format`        | Format the repository with Oxfmt.                      |
| `pnpm db:generate`   | Generate a Drizzle SQL migration from schema changes.  |
| `pnpm docs:dev`      | Start the documentation development server.            |
| `pnpm docs:build`    | Build and validate the documentation site.             |
| `pnpm docs:preview`  | Preview the built documentation site.                  |

## Project structure

- Keep SvelteKit request handling in `src/routes/` and shared server behavior in `src/lib/server/`.
- Keep background work out of web requests and dispatch it through the worker queues.
- Never import `src/lib/server/` modules into client code.
- Colocate tests with their source as `*.test.ts`; frontend tests use a jsdom environment annotation.
- Add SQL migrations under `drizzle/` through Drizzle Kit rather than editing schema history manually.

See the [architecture reference](/reference/architecture) for process and data-flow details.

## Tests and quality gates

Vitest runs with file parallelism disabled and uses demo mode, so the default suite does not require
PostgreSQL or live mail services. External integrations are mocked at module boundaries. Coverage is
enforced at 100% for statements, branches, functions, and lines.

Before opening a pull request, run:

```sh
pnpm format
pnpm lint
pnpm test:coverage
pnpm check
pnpm docs:build
pnpm build
```

Husky runs the repository validation hook before commits. Commit messages use Conventional Commits
with an allowed type and scope. Read
[CONTRIBUTING.md](https://github.com/pmh-only/mail/blob/main/CONTRIBUTING.md) and complete the pull
request template before submitting changes.

Pull request labeling runs are serialized per PR. Size labeling preserves the current correct size
label and tolerates already-removed stale labels, avoiding races when label events trigger more runs.

## Dependency compatibility

The app uses SvelteKit 3 with `@sveltejs/adapter-auto` 8 and `@sveltejs/adapter-node` 6.
Configure SvelteKit in the `sveltekit(...)` plugin in `vite.config.ts`, not `svelte.config.js`.
The existing `$lib` imports are preserved through explicit Vite and TypeScript aliases. The root TypeScript
configuration extends `$app/tsconfig` and declares its own included and excluded files.

Server modules share `src/lib/server/env-private.ts` to read runtime environment variables in both
the web and worker processes, without bundling deployment secrets or requiring build-time values.
The web Vite config loads mode-specific `.env` files into the process environment for local development;
exported environment variables take precedence over those files.
The custom Node server preserves runtime `ORIGIN` through adapter headers that it overwrites on
every request; do not replace this with a build-time `paths.origin` in container builds.

Error-page home actions use the root route ID (`resolve('/')`) so recovery works from nested URLs.
The server error hook skips expected client and validation failures below status 500, while logging
server failures and unknown exceptions without exposing their details to clients.

## Documentation changes

Documentation pages live in `docs/` and use VitePress. Navigation and sidebar entries are configured
in `docs/.vitepress/config.ts`; theme overrides are in `docs/.vitepress/theme/`.

Keep Mermaid on major version 11 while using `vitepress-plugin-mermaid` 2.0.17, whose supported
Mermaid versions are 10 and 11. Check the plugin's peer dependencies before upgrading Mermaid.

Add new pages to the sidebar, use root-relative links for other documentation pages, and run
`pnpm docs:build` to catch broken internal links before committing.
