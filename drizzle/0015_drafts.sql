CREATE TABLE mail_draft (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  to_addr     TEXT    NOT NULL DEFAULT '',
  cc          TEXT    NOT NULL DEFAULT '',
  bcc         TEXT    NOT NULL DEFAULT '',
  subject     TEXT    NOT NULL DEFAULT '',
  html        TEXT    NOT NULL DEFAULT '',
  in_reply_to TEXT
);
