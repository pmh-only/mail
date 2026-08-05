ALTER TABLE "openpgp_key" ADD COLUMN "encryption_email" text;
ALTER TABLE "openpgp_key" ADD COLUMN "encryption_confirmed_at" timestamp with time zone;
ALTER TABLE "openpgp_key" ADD COLUMN "encryption_source" text;
CREATE INDEX "openpgp_key_encryption_email_idx" ON "openpgp_key" ("encryption_email");
