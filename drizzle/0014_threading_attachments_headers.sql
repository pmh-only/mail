ALTER TABLE mail_message ADD COLUMN in_reply_to TEXT;
--> statement-breakpoint
ALTER TABLE mail_message ADD COLUMN "references" TEXT;
--> statement-breakpoint
ALTER TABLE mail_message ADD COLUMN cc TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE mail_message ADD COLUMN thread_id TEXT;
--> statement-breakpoint
CREATE INDEX mail_message_thread_id_idx ON mail_message(thread_id);
--> statement-breakpoint
CREATE TABLE mail_attachment (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id   TEXT    NOT NULL REFERENCES mail_message(message_id) ON DELETE CASCADE,
  filename     TEXT    NOT NULL DEFAULT '',
  content_type TEXT    NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  content      BLOB    NOT NULL
);
--> statement-breakpoint
CREATE INDEX mail_attachment_message_id_idx ON mail_attachment(message_id);
