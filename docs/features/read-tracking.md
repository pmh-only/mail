# Read tracking

For an HTML message sent through the worker, mail adds a unique one-pixel image when a valid public
origin is available. The first qualifying request after delivery records the message as opened. Sent
mail and external API send-job results expose the recorded open time.

## How it works

- Every queued SMTP job receives a random tracking token.
- The worker appends a tokenized URL under `/email-open/.../pixel.gif` to HTML content.
- Same-origin requests and requests carrying this application's cookies are ignored to avoid
  recording the sender's own preview.
- Only the first external open is stored.
- If browser push is configured, the worker can send an **Email read** notification to subscribed
  devices.

Tracking pixels are not reliable delivery or identity proof. Recipients can block remote images,
mail providers can proxy or prefetch images, and several people can view the same mailbox. Inform
recipients and follow applicable privacy law before relying on this feature.

There is currently no per-message or global Settings toggle for outgoing tracking. If `ORIGIN` is
missing or invalid in the worker environment, the pixel is not added.

## Configuration

| Item                          | Setting name                                                                           | Environment variable | Requirement                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| Tracking pixel URL            | None                                                                                   | `ORIGIN`             | Required on the worker for tracking. Must be a public HTTP or HTTPS origin reachable by recipients. |
| Read status                   | None                                                                                   | None                 | Recorded automatically after a tracked SMTP job is delivered and the pixel is requested.            |
| Read push notification        | `Settings > Notifications > Generate VAPID keys` and per-device `Enable notifications` | None                 | Optional. See [Push notifications](/features/notifications).                                        |
| Background notification retry | None                                                                                   | None                 | Requires the worker.                                                                                |

`ORIGIN` should be identical on web and worker processes and must exactly match the deployed site.
