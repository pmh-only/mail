CREATE TABLE mail_filter (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  field      TEXT    NOT NULL,
  operator   TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  target     TEXT
);
