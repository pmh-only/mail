# CONTRIBUTING

## Git Hooks

Husky manages the Git hooks in `.husky/`.
Always confirm Husky is the active hook manager before starting work, and restore it if it is not:

```sh
git config --get core.hooksPath   # must print .husky/_
pnpm exec husky                   # re-installs it when missing or pointing elsewhere
```

## Commits

All commits must follow the Conventional Commits format and include a brief description.
For the braking changes including api change or require full mailbox re-sync must include `!` mark like `feat(something)!:`
Use only `fix`, `feat` and `chore`. Always include scope in commit message.

Before committing, formatting, linting, tests, coverage checks, type checks, and builds must succeed.
Coverage must stay at 100% for statements, branches, functions, and lines; the `pre-commit` hook fails below that.

## Pull Requests

All contributor must complete the pull request template when creating a pull request.
The pull request title must match the primary commit message.
Pull requests must exclude personal environment changes.
