ALTER TABLE "mailbox_sync" ALTER COLUMN "last_uid" SET DATA TYPE bigint;
ALTER TABLE "mail_message_mailbox" ALTER COLUMN "uid" SET DATA TYPE bigint;
ALTER TABLE "imap_job" ALTER COLUMN "uid" SET DATA TYPE bigint;
ALTER TABLE "mail_thread_summary" ALTER COLUMN "latest_uid" SET DATA TYPE bigint;

ALTER TABLE "mailbox_sync" ADD COLUMN "uid_validity" bigint;
ALTER TABLE "mailbox_sync" ADD COLUMN "highest_modseq" bigint;
ALTER TABLE "mailbox_sync" ADD COLUMN "last_reconciled_at" timestamp with time zone;
ALTER TABLE "mailbox_catalog" ADD COLUMN "special_use" text;

DELETE FROM "imap_job"
WHERE "type" IN ('mark_read', 'mark_unread')
  AND "status" IN ('done', 'failed');

DELETE FROM "imap_job" AS older
USING "imap_job" AS newer
WHERE older."type" IN ('mark_read', 'mark_unread')
  AND newer."type" IN ('mark_read', 'mark_unread')
  AND older."status" IN ('pending', 'running')
  AND newer."status" IN ('pending', 'running')
  AND older."mailbox" = newer."mailbox"
  AND older."uid" = newer."uid"
  AND older."id" < newer."id";

UPDATE "imap_job"
SET "dedupe_key" = 'seen:' || "mailbox" || ':' || "uid"
WHERE "type" IN ('mark_read', 'mark_unread')
  AND "status" IN ('pending', 'running');
