# Privacy controls

mail limits automatic contact with resources embedded in received messages and adds warnings around
links and attachments. These controls reduce accidental tracking and unsafe file handling, but they
do not make untrusted content inherently safe.

## Remote content

Mailbox messages support three privacy modes: **Only text** ignores the HTML body, **Style included**
keeps email formatting while blocking images and other external resources, and **Full featured** loads
the styled HTML and its images. Style included is the default. In that mode, the reader can allow
content for one message, and a sender can be added to the trusted list so future messages from that
exact address load remote resources automatically.

Shared links support **Only text** and **Style included**. Shared messages never automatically load
remote images or other external resources.

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
| Mailbox message display    | `Settings > Privacy > Mailbox message display`        | None                 | Optional; Style included by default.              |
| Shared message display     | `Settings > Privacy > Shared message display`         | None                 | Optional; Style included by default.              |
| Sender exceptions          | `Settings > Privacy > Trusted remote content senders` | None                 | Optional; enter one exact email address per line. |
| Link destination warning   | None                                                  | None                 | Always enabled; no setting is required.           |
| Attachment safety warnings | None                                                  | None                 | Always enabled; no setting is required.           |

See [Read tracking](/features/read-tracking) for tracking added to outgoing mail and
[Mail authentication](/features/mail-authentication) for SPF, DKIM, and DMARC indicators.
