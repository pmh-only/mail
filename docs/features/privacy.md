# Privacy controls

mail limits automatic contact with resources embedded in received messages and adds warnings around
links and attachments. These controls reduce accidental tracking and unsafe file handling, but they
do not make untrusted content inherently safe.

## Remote content

Remote images and other external resources are blocked by default. The reader can allow content for
one message, and a sender can be added to the trusted list so future messages from that exact address
load remote resources automatically.

Loading remote content reveals at least the browser's network address and request metadata to the
remote host. Leave blocking enabled unless the sender and content are trusted.

## Links and attachments

- HTTP, HTTPS, mailto, and telephone links are opened through a destination warning that shows the
  resolved host or protocol.
- Unsafe URL protocols are rejected.
- Attachment warnings identify executable or script-like extensions, macro-enabled Office files,
  archives, double extensions, hidden control characters, MIME mismatches, and unusual high-risk
  files.
- Image, PDF, and video previews stay in the application, but opening or downloading an attachment
  still gives the browser access to untrusted bytes.

## Configuration

| Item                       | Setting name                                          | Environment variable | Requirement                                       |
| -------------------------- | ----------------------------------------------------- | -------------------- | ------------------------------------------------- |
| Remote-content blocking    | `Settings > Privacy > Block remote email content`     | None                 | Optional; enabled by default.                     |
| Sender exceptions          | `Settings > Privacy > Trusted remote content senders` | None                 | Optional; enter one exact email address per line. |
| Link destination warning   | None                                                  | None                 | Always enabled; no setting is required.           |
| Attachment safety warnings | None                                                  | None                 | Always enabled; no setting is required.           |

See [Read tracking](/features/read-tracking) for tracking added to outgoing mail and
[Mail authentication](/features/mail-authentication) for SPF, DKIM, and DMARC indicators.
