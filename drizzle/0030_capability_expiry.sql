ALTER TABLE "mail_share" ADD COLUMN "expires_at" timestamp with time zone;
ALTER TABLE "mail_share" ADD COLUMN "revoked_at" timestamp with time zone;
UPDATE "mail_share" SET "expires_at" = "created_at" + interval '30 days';
ALTER TABLE "mail_share" ALTER COLUMN "expires_at" SET NOT NULL;
CREATE INDEX "mail_share_expires_at_idx" ON "mail_share" ("expires_at");

ALTER TABLE "public_attachment" ADD COLUMN "expires_at" timestamp with time zone;
ALTER TABLE "public_attachment" ADD COLUMN "revoked_at" timestamp with time zone;
UPDATE "public_attachment" SET "expires_at" = "created_at" + interval '30 days';
ALTER TABLE "public_attachment" ALTER COLUMN "expires_at" SET NOT NULL;
CREATE INDEX "public_attachment_cleanup_idx" ON "public_attachment" ("committed_at", "created_at");
