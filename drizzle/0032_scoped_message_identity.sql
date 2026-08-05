ALTER TABLE "mail_message" ADD COLUMN "config_id" text NOT NULL DEFAULT 'primary';
ALTER TABLE "mail_message" ADD COLUMN "orphaned_at" timestamp with time zone;
ALTER TABLE "mail_message" DROP CONSTRAINT IF EXISTS "mail_message_message_id_unique";
CREATE UNIQUE INDEX "mail_message_config_message_id_idx" ON "mail_message" ("config_id", "message_id");
CREATE INDEX "mail_message_orphaned_at_idx" ON "mail_message" ("orphaned_at");

ALTER TABLE "mail_message_mailbox" ADD COLUMN "config_id" text NOT NULL DEFAULT 'primary';
ALTER TABLE "mail_message_mailbox" ADD COLUMN "mail_message_id" integer;
UPDATE "mail_message_mailbox" AS mmb SET "mail_message_id" = mm."id" FROM "mail_message" AS mm WHERE mm."message_id" = mmb."message_id";
ALTER TABLE "mail_message_mailbox" ALTER COLUMN "mail_message_id" SET NOT NULL;
ALTER TABLE "mail_message_mailbox" ADD CONSTRAINT "mail_message_mailbox_mail_message_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "mail_message"("id") ON DELETE CASCADE;
CREATE INDEX "mail_message_mailbox_mail_message_id_idx" ON "mail_message_mailbox" ("mail_message_id");

ALTER TABLE "mail_attachment" ADD COLUMN "mail_message_id" integer;
UPDATE "mail_attachment" AS ma SET "mail_message_id" = mm."id" FROM "mail_message" AS mm WHERE mm."message_id" = ma."message_id";
ALTER TABLE "mail_attachment" ALTER COLUMN "mail_message_id" SET NOT NULL;
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_mail_message_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "mail_message"("id") ON DELETE CASCADE;
CREATE INDEX "mail_attachment_mail_message_id_idx" ON "mail_attachment" ("mail_message_id");

CREATE OR REPLACE FUNCTION mark_mail_message_orphaned() RETURNS trigger AS $$
BEGIN
  UPDATE "mail_message" SET "orphaned_at" = now()
  WHERE "id" = OLD."mail_message_id"
    AND NOT EXISTS (SELECT 1 FROM "mail_message_mailbox" WHERE "mail_message_id" = OLD."mail_message_id");
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "mail_message_mailbox_orphaned" AFTER DELETE ON "mail_message_mailbox" FOR EACH ROW EXECUTE FUNCTION mark_mail_message_orphaned();

CREATE OR REPLACE FUNCTION clear_mail_message_orphaned() RETURNS trigger AS $$
BEGIN
  UPDATE "mail_message" SET "orphaned_at" = NULL WHERE "id" = NEW."mail_message_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "mail_message_mailbox_referenced" AFTER INSERT ON "mail_message_mailbox" FOR EACH ROW EXECUTE FUNCTION clear_mail_message_orphaned();
