# Search

Search runs across synchronized mail rather than querying the IMAP server. Results can span all
stored mailboxes and include each result's source mailbox.

## Structured and text search

Typing starts a normal search after a short delay. Plain terms search message content and metadata.
The following operators narrow results:

| Operator         | Example                  | Meaning                              |
| ---------------- | ------------------------ | ------------------------------------ |
| `from:`          | `from:alice@example.com` | Sender contains the value.           |
| `to:`            | `to:team@example.com`    | Recipient contains the value.        |
| `subject:`       | `subject:"release plan"` | Subject contains the value.          |
| `has:attachment` | `has:attachment`         | Message has at least one attachment. |
| `before:`        | `before:2026-01-01`      | Received before the date.            |
| `after:`         | `after:2026-01-01`       | Received after the date.             |

The search box suggests operators and matching contacts. Searches can be named, saved, reused, and
deleted from the saved-search menu.

## Natural-language search

When OpenAI is configured, pressing Enter on a query without an explicit operator starts
natural-language search. The model chooses bounded regular-expression searches, can retry with
synonyms or translated terms, and returns only IDs found by those searches. Explicit operator
queries always use normal search.

## Configuration

| Item                         | Setting name                                | Environment variable | Requirement                                                       |
| ---------------------------- | ------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| Normal and structured search | None                                        | None                 | No feature-specific configuration. Synchronized mail is required. |
| Saved searches               | Saved-search menu in the mailbox search bar | None                 | Optional and stored in PostgreSQL.                                |
| Natural-language search      | `Settings > AI Features > OpenAI API key`   | `OPENAI_API_KEY`     | Required only for AI search.                                      |
| AI search model              | `Settings > AI Features > Model`            | `OPENAI_MODEL`       | Optional; defaults to `gpt-4.1-mini`.                             |

Natural-language queries and bounded message metadata are sent to OpenAI. See
[AI features](/features/ai) for the complete data-use summary.
