# Settings backup and restore

The Settings backup feature exports portable, versioned JSON for non-secret application settings.
It is intended for transferring preferences and rules, not for disaster recovery.

## Included data

- IMAP and SMTP server metadata without passwords.
- OpenAI model and automatic-importance preference without the API key.
- Interface, privacy, mailbox, translation, theme, and sharing preferences.
- The legacy default signature value.
- Filters and saved searches.

Import validates the application name and schema version. You can independently restore server
settings, interface preferences, filters, and saved searches. Selected list sections are replaced,
not merged.

## Excluded data

Passwords, OAuth and OIDC client secrets, OpenAI API keys, OpenPGP keys, API keys, VAPID private
keys, push subscriptions, messages, attachments, contacts, templates, signature profiles, sender
rules, cleanup rules, authentication records, sessions, audit events, and queued jobs are not a part
of the JSON settings backup.

Use the deployment backup process for the PostgreSQL database, public-attachment directory, and
`MAIL_SECRET_KEY`. Those items must be restored together.

## Configuration

| Item                     | Setting name                                                                                    | Environment variable                                           | Requirement                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Export JSON              | `Settings > Backup > Export settings`                                                           | None                                                           | No feature-specific configuration.                                                        |
| Import JSON              | `Settings > Backup > Import settings`                                                           | None                                                           | A valid versioned mail settings JSON file is required.                                    |
| Restore selection        | `Settings > Backup > Server settings`, `Interface preferences`, `Filters`, and `Saved searches` | None                                                           | Select at least the sections you intend to replace.                                       |
| Full installation backup | None                                                                                            | `DATABASE_URL`, `PUBLIC_ATTACHMENT_DIR`, and `MAIL_SECRET_KEY` | Back up the database contents, attachment directory, and stable key outside this feature. |

See [Deployment: Persistent data](/operations/deployment#persistent-data) for full backup guidance.
