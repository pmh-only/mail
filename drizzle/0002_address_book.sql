CREATE TABLE "mail_contact" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_contact_email_idx" ON "mail_contact" USING btree ("email");--> statement-breakpoint
CREATE INDEX "mail_contact_last_used_at_idx" ON "mail_contact" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "mail_contact_use_count_idx" ON "mail_contact" USING btree ("use_count");
