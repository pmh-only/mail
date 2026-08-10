# PWA and offline access

mail includes a web app manifest and service worker so supported browsers can install it as a
standalone Progressive Web App.

## Installation and operating-system integration

- Supported browsers show an installation notice; the browser menu can also install the app.
- The installed app registers as a `mailto:` handler and opens a prefilled composer for mail links.
- The Web Share Target API can pass shared text, titles, and URLs into a new draft.
- Window-controls overlay is used where the browser supports it.
- On iOS, Home Screen installation is required before Web Push can be enabled.

Browser support and policy determine which integrations are available. Dismissing the install notice
stores that choice in the current browser.

## Offline read cache

The application keeps a best-effort IndexedDB cache of up to 75 opened messages and 12 recent
mailbox-list states per owner. A cached message can be read while offline and is marked as offline in
the reader. Attachment bytes are not stored in this offline cache.

The cache is local to a browser profile, may be evicted by the browser, and is cleared when the
application detects sign-out. It is not a backup and does not queue offline changes for later IMAP
delivery.

## Configuration

| Item                       | Setting name                        | Environment variable | Requirement                                                                                      |
| -------------------------- | ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| PWA installation           | None                                | `ORIGIN`             | No app setting; production installation requires a secure HTTPS origin supported by the browser. |
| `mailto:` handling         | Browser permission after signing in | None                 | Optional and browser-dependent.                                                                  |
| Web share target           | Installed PWA                       | None                 | Optional and browser-dependent.                                                                  |
| Offline read cache         | None                                | None                 | Automatic when IndexedDB is available.                                                           |
| Push from an installed app | `Settings > Notifications`          | None                 | Optional; see [Push notifications](/features/notifications).                                     |

No cache size or offline-retention setting is currently exposed.
