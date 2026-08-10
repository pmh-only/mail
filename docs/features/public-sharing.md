# Public sharing

An authenticated owner can create a public link for one message or an entire thread. Anyone who has
the capability URL can read the shared content and download its synchronized attachments without
signing in.

## Link lifecycle

- Links use random capability tokens and expire after 30 days.
- Creating another link for the same current message or thread reuses the active link.
- A link can be revoked from the share dialog before it expires.
- Opening a valid link records its first read time. The authenticated reader shows how many public
  links for a message have been read.
- Shared pages send a `no-referrer` policy and follow the installation's current theme.

Treat a share URL like a temporary password. Do not place it in public logs, analytics, screenshots,
or referrer-bearing pages. Revoking a link prevents future access but cannot retract content already
downloaded by a recipient.

## Configuration

| Item                          | Setting name                                                 | Environment variable | Requirement                                                                                                               |
| ----------------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Create or revoke a link       | `Message or thread > Share`                                  | None                 | No feature-specific configuration.                                                                                        |
| Normal-click behavior         | `Settings > Interface > Share button actions > Normal click` | None                 | Optional; choose the native share screen or copy URL.                                                                     |
| Shift-click behavior          | `Settings > Interface > Share button actions > Shift-click`  | None                 | Optional; choose the native share screen or copy URL.                                                                     |
| Public URL at a reverse proxy | None                                                         | `ORIGIN`             | The deployment origin should match the URL users open, although share URLs are generated from the current request origin. |

Public message sharing is separate from [public-link outgoing attachments](/features/composing-and-sending),
which have their own storage limits.
