# Demo mode

Demo mode runs the web interface against in-memory sample data. It is useful for evaluation, UI
development, screenshots, and automated tests without connecting real services.

## Behavior

- PostgreSQL, authentication providers, IMAP, SMTP, and the worker are not required.
- Login and setup requirements are bypassed.
- Sample mail, threads, contacts, settings, filters, AI responses, shares, and operations are served
  from the web process.
- Changes are temporary and reset when the web process restarts.
- External services are not contacted by mail and AI demo paths.
- The external REST API, MCP integration, OpenPGP operations, and composed mailboxes are unavailable
  or limited where they require persistent or external state.

Do not use demo mode as a production deployment or expect it to preserve user data.

## Configuration

| Item             | Setting name | Environment variable                                                                     | Requirement                                                                |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Enable demo mode | None         | `DEMO_MODE`                                                                              | Set to `1`, `true`, `yes`, or `on` (case-insensitive). Default is `false`. |
| Database         | None         | `DATABASE_URL`                                                                           | Not required in demo mode.                                                 |
| Authentication   | None         | `ORIGIN` and `BETTER_AUTH_SECRET`                                                        | Not required for demo data.                                                |
| Mail services    | None         | `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`, `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` | Not required and not contacted.                                            |
| Worker           | None         | None                                                                                     | Do not run it for demo data; in-memory state belongs to the web process.   |

Start a local demo with `DEMO_MODE=true pnpm dev`.
