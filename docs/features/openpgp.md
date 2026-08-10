# OpenPGP

mail can sign, encrypt, verify, and decrypt OpenPGP email without a browser extension. It supports
cleartext signatures, detached signatures, PGP/MIME signatures, and PGP/MIME encryption.

## Key management

Under **Settings > OpenPGP**, you can:

- Generate a Curve25519 or RSA-4096 key pair.
- Import armored public or private keys.
- Mark an own private key as the primary signing key.
- Import recipient public keys and download stored public keys.
- Remove keys that should no longer be used.

Own private keys are matched to the selected SMTP sender's email address. A generated or imported
private key is encrypted at rest with `MAIL_SECRET_KEY`; its optional OpenPGP passphrase is stored
with it so the worker can process mail unattended.

## Sending

Advanced compose mode offers cleartext, detached, or PGP/MIME signing, PGP/MIME encryption, and
public-key attachment. Encryption requires a confirmed public key for every To, CC, and BCC
recipient. If a key is missing, mail can query `keys.openpgp.org` and `keyserver.ubuntu.com`; you must
review and confirm the fingerprint before the key is pinned for encryption.

An email-address match is not proof of identity. Compare fingerprints over a trusted channel before
confirming a discovered key.

## Receiving

The worker detects supported signed and encrypted formats during sync and backfill. The reader shows
whether a signature is valid, untrusted, mismatched to the From address, invalid, or unknown, and
whether encrypted content was decrypted. PGP/MIME protects its signed MIME part, not unsigned outer
headers such as Subject.

## Configuration

| Item                | Setting name                                                                     | Environment variable | Requirement                                                                                              |
| ------------------- | -------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Private-key storage | None                                                                             | `MAIL_SECRET_KEY`    | Required before private-key generation or import. Must remain stable and match web and worker processes. |
| Generate own key    | `Settings > OpenPGP > Name`, `Email`, `Algorithm`, and optional `Key passphrase` | None                 | Name and email are required. Email must match a configured SMTP sender to use the key for sending.       |
| Import key          | `Settings > OpenPGP > Import a key`                                              | None                 | An armored key is required; enter its passphrase for an encrypted private key.                           |
| Sign mail           | `Composer > Advanced > OpenPGP`                                                  | None                 | Requires an own private key matching the selected sender.                                                |
| Encrypt mail        | `Composer > Advanced > Encrypt`                                                  | None                 | Requires the sender's own key and a confirmed encryption key for every recipient.                        |
| Attach public key   | `Composer > Advanced > Attach public key`                                        | None                 | Requires the sender's own key.                                                                           |

OpenPGP is unavailable in demo mode. Keep a backup of `MAIL_SECRET_KEY` and exported private keys;
losing the environment key makes encrypted database values unreadable.
