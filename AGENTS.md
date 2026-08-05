## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: oxfmt, oxlint, tailwindcss, drizzle, better-auth, mcp

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
Before committing, formatting, linting, tests, coverage checks, type checks, and builds must succeed.
Coverage must stay at 100% for statements, branches, functions, and lines; the `pre-commit` hook fails below that.

## Pull Requests

All agents must complete the pull request template when creating a pull request.
The pull request title must match the primary commit message.
Pull requests must contain only user-requested changes and exclude personal environment changes.

---

## Svelte Documentation

The Svelte MCP server is not configured for this project. Use Context7 for current Svelte and SvelteKit documentation when needed.
