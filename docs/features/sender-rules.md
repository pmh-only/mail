# Sender rules

Sender rules provide a simple blocklist and allowlist that runs before normal filters whenever new
mail is synchronized.

## Behavior

- A block rule moves matching mail to the detected Trash folder.
- An allow rule for the same normalized sender overrides a block rule.
- Display-name addresses are normalized to their lowercase email address.
- Rules affect newly processed mail; use normal message actions for existing messages.
- If no Trash mailbox can be detected, blocked mail is left in place.

Sender rules are exact normalized-address matches, not domain-wide patterns. Add each address that
should be blocked or explicitly allowed.

## Configuration

| Item                  | Setting name                                                                                 | Environment variable                                             | Requirement                                    |
| --------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Block or allow sender | `Settings > Senders > Type` and `Sender`                                                     | None                                                             | A sender value is required.                    |
| Move blocked mail     | `Settings > IMAP > Host`, `Username / Email`, and `Password`, plus a detectable Trash folder | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | Required for the worker to move mail upstream. |

No sender-rule-specific environment variable exists. Rules are stored in PostgreSQL and applied by
the worker during sync.
