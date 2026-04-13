ALTER TABLE mail_config ADD COLUMN vapid_public_key  TEXT;
--> statement-breakpoint
ALTER TABLE mail_config ADD COLUMN vapid_private_key TEXT;
--> statement-breakpoint
ALTER TABLE mail_config ADD COLUMN vapid_subject     TEXT;
--> statement-breakpoint
CREATE TABLE mail_push_subscription (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
