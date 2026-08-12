CREATE TABLE "rostack_event" (
	"cursor" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"resource" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_version" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rostack_event_event_id_idx" ON "rostack_event" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "rostack_event_resource_cursor_idx" ON "rostack_event" USING btree ("resource", "cursor");
--> statement-breakpoint
CREATE TABLE "rostack_snapshot_page" (
	"cursor" text PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"items" jsonb NOT NULL,
	"next_cursor" text,
	"event_cursor" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rostack_snapshot_page_expires_at_idx" ON "rostack_snapshot_page" USING btree ("expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_rostack_mailbox_entry_event() RETURNS trigger AS $$
DECLARE
	entry_id text;
	event_name text;
	event_uuid text;
BEGIN
	entry_id := COALESCE(NEW.id, OLD.id)::text;
	event_name := CASE TG_OP
		WHEN 'INSERT' THEN 'mailbox-entry.created'
		WHEN 'UPDATE' THEN 'mailbox-entry.updated'
		ELSE 'mailbox-entry.deleted'
	END;
	event_uuid := md5(random()::text || clock_timestamp()::text || entry_id);
	INSERT INTO rostack_event (event_id, resource, event_type, resource_id, resource_version)
	VALUES (event_uuid, 'mailbox-entries', event_name, entry_id, event_uuid);
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "mail_message_mailbox_rostack_event"
AFTER INSERT OR UPDATE OR DELETE ON "mail_message_mailbox"
FOR EACH ROW EXECUTE FUNCTION record_rostack_mailbox_entry_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_rostack_message_update_events() RETURNS trigger AS $$
DECLARE
	entry record;
	event_uuid text;
BEGIN
	FOR entry IN SELECT id FROM mail_message_mailbox WHERE mail_message_id = NEW.id LOOP
		event_uuid := md5(random()::text || clock_timestamp()::text || entry.id::text);
		INSERT INTO rostack_event (event_id, resource, event_type, resource_id, resource_version)
		VALUES (event_uuid, 'mailbox-entries', 'mailbox-entry.updated', entry.id::text, event_uuid);
	END LOOP;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "mail_message_rostack_event"
AFTER UPDATE ON "mail_message"
FOR EACH ROW EXECUTE FUNCTION record_rostack_message_update_events();
