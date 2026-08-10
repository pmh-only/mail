# Mail authentication

The reader displays SPF, DKIM, and DMARC outcomes parsed from a received message's trusted
`Authentication-Results` header. These indicators report what a receiving mail service evaluated;
mail does not perform DNS-based SPF, DKIM, or DMARC validation itself.

## Trust model

An `Authentication-Results` header is trusted only when its `authserv-id` matches the configured
allowlist. Exact IDs and wildcard subdomains are supported. For example, `*.google.com` matches a
Google subdomain but not an unrelated domain ending in the same text.

Without a matching trusted ID, the reader can still show parsed statuses, but the indicator is
visually marked as not reported by a trusted receiving service. Configure only IDs emitted by the
mail system that actually received the message; trusting an arbitrary sender-controlled ID defeats
the boundary.

## Configuration

| Item                                | Setting name | Environment variable             | Requirement                                                                                                                |
| ----------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Trusted receiving services          | None         | `MAIL_AUTH_TRUSTED_AUTHSERV_IDS` | Optional but required for results to be marked trusted. Use a comma-separated list of exact IDs or `*.` wildcard suffixes. |
| Authentication parsing and backfill | None         | None                             | Automatic for synchronized mail. The worker must be running.                                                               |

Set `MAIL_AUTH_TRUSTED_AUTHSERV_IDS` identically on the web and worker processes so stored results and
reader trust indicators use the same policy.
