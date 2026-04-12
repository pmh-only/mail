CREATE VIRTUAL TABLE IF NOT EXISTS mail_message_fts USING fts5(
  subject,
  "from",
  "to",
  text_content,
  content='mail_message',
  content_rowid='id'
);
--> statement-breakpoint
INSERT INTO mail_message_fts(rowid, subject, "from", "to", text_content)
SELECT id, subject, "from", "to", text_content FROM mail_message;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS mail_message_ai AFTER INSERT ON mail_message BEGIN
  INSERT INTO mail_message_fts(rowid, subject, "from", "to", text_content)
  VALUES (new.id, new.subject, new."from", new."to", new.text_content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS mail_message_ad AFTER DELETE ON mail_message BEGIN
  INSERT INTO mail_message_fts(mail_message_fts, rowid, subject, "from", "to", text_content)
  VALUES ('delete', old.id, old.subject, old."from", old."to", old.text_content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS mail_message_au AFTER UPDATE ON mail_message BEGIN
  INSERT INTO mail_message_fts(mail_message_fts, rowid, subject, "from", "to", text_content)
  VALUES ('delete', old.id, old.subject, old."from", old."to", old.text_content);
  INSERT INTO mail_message_fts(rowid, subject, "from", "to", text_content)
  VALUES (new.id, new.subject, new."from", new."to", new.text_content);
END;
