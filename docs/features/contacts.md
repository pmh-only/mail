# Contacts and groups

The address book supplies suggestions to To, CC, and BCC fields and makes recurring recipients
easier to select.

## Contacts

- Add, edit, delete, and search contacts by name or email.
- Import addresses found in the latest synchronized message history.
- Preview and import CSV files containing an `email` header and an optional `name` header.
- Export the address book as `contacts.csv`.
- Open a contact to review its source, usage history, and recent related messages.

Imported and manually entered addresses are deduplicated by normalized email address. Repeated
imports update non-empty names, usage counts, and the most recent use time instead of creating a
second contact.

## Groups

Groups have a name, optional description, and selected address-book members. Selecting a group in
the composer expands it into all current member addresses. Deleting a group does not delete its
contacts.

## Configuration

| Item         | Setting name                                              | Environment variable | Requirement                                     |
| ------------ | --------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| Contacts     | `Contacts > Add contact` or `Contacts > Import from mail` | None                 | No feature-specific configuration.              |
| CSV transfer | `Contacts > Import CSV` or `Contacts > Export CSV`        | None                 | Optional.                                       |
| Groups       | `Contacts > New group`                                    | None                 | A group name is required; members are optional. |

Contacts and groups are stored in PostgreSQL. Importing from mail requires previously synchronized
messages but does not contact an external address-book provider.
