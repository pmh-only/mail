ALTER TABLE "imap_job" ALTER COLUMN "uid" DROP NOT NULL;
ALTER TABLE "imap_job" ADD COLUMN "draft_id" integer;
ALTER TABLE "imap_job" ADD COLUMN "uid_validity" bigint;

ALTER TABLE "mail_draft" ADD COLUMN "imap_mailbox" text;
ALTER TABLE "mail_draft" ADD COLUMN "imap_uid" bigint;
ALTER TABLE "mail_draft" ADD COLUMN "imap_uid_validity" bigint;
ALTER TABLE "mail_draft" ADD COLUMN "imap_synced_at" timestamp with time zone;
ALTER TABLE "mail_draft" ADD COLUMN "imap_sync_error" text;
