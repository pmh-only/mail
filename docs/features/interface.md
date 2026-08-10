# Interface

Interface preferences are stored in PostgreSQL for the installation owner and apply across signed-in
devices.

## Appearance and layout

- **Color mode** follows the system or forces light or dark mode.
- **Color theme** can be disabled, selected from a preset, or built as a custom multi-color gradient
  with a chosen angle.
- **Display density** changes spacing in message lists, the sidebar, and the reader.
- The sidebar width and message-list split are adjustable and persisted automatically.
- Mailbox pages can default to conversation threads and/or swipeable card view.
- The browser title and favicon show the unread count for the primary IMAP account's default mailbox
  and refresh with mailbox state about every 30 seconds.

## Sharing preferences

The normal-click and Shift-click share actions can independently open the browser's native share
sheet or copy the public URL. These preferences affect the message and thread Share button, not the
PWA's operating-system share target.

## Keyboard shortcuts

Press `?` to open the complete shortcut overlay. Common shortcuts include:

| Area         | Keys                    | Action                                                    |
| ------------ | ----------------------- | --------------------------------------------------------- |
| Navigation   | Arrow keys or `j` / `k` | Move between panels or messages.                          |
| Mail list    | `x`, `* a`, `* n`       | Toggle selection, select all visible, or clear selection. |
| Mail actions | `e`, `#`                | Archive or move to trash.                                 |
| Compose      | `c`                     | Start a new message.                                      |
| Reader       | `r`, `a`, `f`, `u`      | Reply, reply all, forward, or return to the list.         |
| Composer     | `Esc`                   | Minimize while retaining the draft.                       |

## Configuration

| Item                | Setting name                                                      | Environment variable | Requirement                                |
| ------------------- | ----------------------------------------------------------------- | -------------------- | ------------------------------------------ |
| Color mode          | `Settings > Interface > Color mode`                               | None                 | Optional; defaults to System.              |
| Theme               | `Settings > Interface > Color theme`                              | None                 | Optional; choose Off, a preset, or Custom. |
| Default thread view | `Settings > Interface > Use thread mode on page load`             | None                 | Optional; enabled by default.              |
| Default card view   | `Settings > Interface > Use simplified mailbox view on page load` | None                 | Optional.                                  |
| Share actions       | `Settings > Interface > Share button actions`                     | None                 | Optional.                                  |
| Density             | `Settings > Interface > Display density`                          | None                 | Optional; defaults to Comfortable.         |
| Unread title badge  | `Settings > IMAP > Default Mailbox`                               | `IMAP_MAILBOX`       | Automatic; the count follows this mailbox. |
| Keyboard shortcuts  | None                                                              | None                 | Always available; press `?`.               |

No interface-specific environment variable exists.
