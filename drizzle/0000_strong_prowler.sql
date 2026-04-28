CREATE TABLE "imap_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"mailbox" text NOT NULL,
	"uid" integer NOT NULL,
	"target_mailbox" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_attachment" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"imap_host" text,
	"imap_port" integer,
	"imap_secure" boolean,
	"imap_user" text,
	"imap_password" text,
	"imap_mailbox" text,
	"imap_poll_seconds" integer,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean,
	"smtp_user" text,
	"smtp_password" text,
	"smtp_from" text,
	"oidc_discovery_url" text,
	"oidc_client_id" text,
	"oidc_client_secret" text,
	"signature" text,
	"vapid_public_key" text,
	"vapid_private_key" text,
	"vapid_subject" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mail_draft" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_addr" text DEFAULT '' NOT NULL,
	"cc" text DEFAULT '' NOT NULL,
	"bcc" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"attachments" text DEFAULT '[]' NOT NULL,
	"in_reply_to" text
);
--> statement-breakpoint
CREATE TABLE "mail_filter" (
	"id" serial PRIMARY KEY NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"value" text NOT NULL,
	"action" text NOT NULL,
	"target" text
);
--> statement-breakpoint
CREATE TABLE "mail_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from" text DEFAULT '' NOT NULL,
	"to" text DEFAULT '' NOT NULL,
	"cc" text DEFAULT '' NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"text_content" text DEFAULT '' NOT NULL,
	"html_content" text,
	"in_reply_to" text,
	"references" text,
	"thread_id" text,
	"thread_key" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone,
	CONSTRAINT "mail_message_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "mail_message_mailbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"mailbox" text NOT NULL,
	"uid" integer NOT NULL,
	"flags" text DEFAULT '[]' NOT NULL,
	"received_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_push_subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "mail_share" (
	"token" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_thread_summary" (
	"mailbox" text NOT NULL,
	"thread_key" text NOT NULL,
	"representative_mailbox_entry_id" integer NOT NULL,
	"thread_count" integer NOT NULL,
	"latest_uid" integer NOT NULL,
	"latest_received_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mailbox_catalog" (
	"path" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"delimiter" text DEFAULT '/' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_sync" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"last_uid" integer DEFAULT 0 NOT NULL,
	"history_complete" boolean DEFAULT false NOT NULL,
	"last_fetched_count" integer DEFAULT 0 NOT NULL,
	"last_stored_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "sync_runtime" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_syncing" boolean DEFAULT false NOT NULL,
	"active_mailbox" text,
	"active_stored" integer DEFAULT 0 NOT NULL,
	"active_total" integer DEFAULT 0 NOT NULL,
	"last_run_started_at" timestamp with time zone,
	"last_run_finished_at" timestamp with time zone,
	"worker_heartbeat_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imap_job_dedupe_key_idx" ON "imap_job" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "imap_job_status_available_at_idx" ON "imap_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "mail_attachment_message_id_idx" ON "mail_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_message_thread_id_idx" ON "mail_message" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "mail_message_thread_key_idx" ON "mail_message" USING btree ("thread_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_mailbox_mailbox_uid_idx" ON "mail_message_mailbox" USING btree ("mailbox","uid");--> statement-breakpoint
CREATE INDEX "mail_message_mailbox_message_id_idx" ON "mail_message_mailbox" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_message_mailbox_mailbox_received_at_uid_idx" ON "mail_message_mailbox" USING btree ("mailbox","received_at","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_thread_summary_mailbox_thread_key_idx" ON "mail_thread_summary" USING btree ("mailbox","thread_key");--> statement-breakpoint
CREATE INDEX "mail_thread_summary_mailbox_latest_received_at_uid_idx" ON "mail_thread_summary" USING btree ("mailbox","latest_received_at","latest_uid");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");