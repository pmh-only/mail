# Push notifications

mail uses the Web Push protocol to notify installed or open browsers about newly synchronized mail
and tracked outgoing-message reads.

## Setup

1. Open **Settings > Notifications** and generate VAPID keys once for the installation.
2. Reload the page when prompted.
3. Enable notifications on each browser or installed app that should receive them.
4. Use **Send test** to verify the current device.

VAPID keys and browser subscriptions are stored in PostgreSQL. There are no VAPID environment
variables. On iOS, install the PWA on the Home Screen before requesting push permission.

## Delivery controls

- New-mail notifications can be enabled or disabled per synchronized mailbox.
- Sent and draft-like mailboxes never notify.
- Quiet hours suppress pushes inside a daily local-time window, including windows crossing midnight.
- A notification can open its message, and supported subscriptions can mark a message read from the
  notification action.
- Reading mail in one client dismisses matching new-mail notifications on other capable clients.

## Configuration

| Item                             | Setting name                                                             | Environment variable | Requirement                                                                               |
| -------------------------------- | ------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------- |
| Server push identity             | `Settings > Notifications > Generate VAPID keys`                         | None                 | Required once per installation.                                                           |
| Device subscription              | `Settings > Notifications > Enable notifications`                        | None                 | Required on each device. Browser permission and service-worker support are also required. |
| Mailbox delivery                 | `Settings > Notifications > Mailbox notification rules`                  | None                 | Optional; eligible mailboxes are enabled by default.                                      |
| Quiet hours                      | `Settings > Notifications > Quiet hours`, `Start`, `End`, and `Timezone` | None                 | Optional; timezone must be an IANA name such as `America/New_York`.                       |
| New-mail and read-event dispatch | None                                                                     | None                 | Requires the worker.                                                                      |
| Secure browser context           | None                                                                     | `ORIGIN`             | Production should use an HTTPS origin; localhost is suitable for development.             |

Quiet hours suppress both new-mail and read-event push notifications. They do not pause sync,
filtering, sending, or read tracking itself.
