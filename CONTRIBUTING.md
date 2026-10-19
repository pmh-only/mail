# CONTRIBUTING

## Git Hooks

This project does not install Git hooks. Run the validation commands manually before committing.

## Commits

All commits must follow the Conventional Commits format and include a brief description.
For the braking changes including api change or require full mailbox re-sync must include `!` mark like `feat(something)!:`
Use only `fix`, `feat` and `chore`. Always include scope in commit message.

Before committing, formatting, linting, tests, coverage checks, type checks, and builds must succeed.
Coverage must stay at 100% for statements, branches, functions, and lines; `pnpm test:coverage` fails below that.

## Pull Requests

All contributor must complete the pull request template when creating a pull request.
The pull request title must match the primary commit message.
Pull requests must exclude personal environment changes.
