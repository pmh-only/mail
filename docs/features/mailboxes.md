# Mailboxes

The worker discovers folders from every configured IMAP account and assigns common roles such as
Inbox, Sent, Drafts, Archive, Trash, and Spam from IMAP special-use metadata and folder names.
Multi-account folder paths are namespaced by account so they remain distinct.

## Sidebar organization

Use **Settings > Mailboxes** to:

- Choose the mailbox opened when the root application URL is loaded.
- Show or hide synchronized folders.
- Move folders into the preferred sidebar order.
- Reset the stored order when the server folder list changes.

Account groups can also be collapsed from the sidebar. The preference is stored with the other
mailbox layout preferences.

## Composed mailboxes

A composed mailbox combines two or more synchronized folders into one deduplicated view. Give it a
name and icon, then select its source folders. This is useful for a combined inbox across accounts
or a project view assembled from several folders. Composed mailboxes are local views; they do not
create or rename an IMAP folder.

When the same message exists in multiple source folders, opening it keeps the selected folder copy
active. This includes messages sent to your own address that appear in both Inbox and Sent.

## Configuration

| Item                        | Setting name                                                 | Environment variable                                             | Requirement                                                       |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Discovered folders          | `Settings > IMAP > Host`, `Username / Email`, and `Password` | `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD`, or `IMAP_SERVERS` | At least one complete IMAP account is required outside demo mode. |
| Initial sync folder         | `Settings > IMAP > Default Mailbox`                          | `IMAP_MAILBOX`                                                   | Optional; defaults to `INBOX`.                                    |
| Default app mailbox         | `Settings > Mailboxes > Default mailbox`                     | None                                                             | Optional; defaults to Inbox.                                      |
| Folder visibility and order | `Settings > Mailboxes` folder list                           | None                                                             | Optional.                                                         |
| Composed mailbox            | `Settings > Mailboxes > Composed mailboxes`                  | None                                                             | Requires a name and at least two synchronized source folders.     |

Composed mailboxes are unavailable in demo mode.
