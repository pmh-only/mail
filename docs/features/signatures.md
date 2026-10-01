# Signatures

Signatures are reusable HTML or plain-text blocks added to new messages, replies, and forwards. Multiple profiles can be
stored, named, and selected from the advanced composer.

## Behavior

- One profile can be marked as the default for new messages, replies, reply-all, and forwards.
- For new messages, the advanced composer can switch to another profile or remove the signature before sending.
- Changing the selected profile replaces the signature currently at the end of the draft.
- Replies and forwards automatically insert the default signature before the quoted reply header or forwarded-message line, after any generated reply text.
- Signature content is stored in PostgreSQL and included in a draft after selection.

## Configuration

| Item                  | Setting name                                        | Environment variable | Requirement                                      |
| --------------------- | --------------------------------------------------- | -------------------- | ------------------------------------------------ |
| Signature profile     | `Settings > Signatures > Name` and `Signature HTML` | None                 | Optional. Both plain text and HTML are accepted. |
| Default signature     | `Settings > Signatures > Default`                   | None                 | Optional; one saved profile can be the default.  |
| Per-message selection | `Composer > Advanced > Signature`                   | None                 | Optional for a new, unsaved message.             |

No signature-specific environment variable is available or required.
