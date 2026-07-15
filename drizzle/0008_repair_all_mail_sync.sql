UPDATE "mailbox_sync"
SET "last_uid" = 0,
    "history_complete" = false,
    "last_synced_at" = NULL
WHERE "mailbox" ~* 'all[ ._-]?mail';
