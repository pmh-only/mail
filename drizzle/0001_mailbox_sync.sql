CREATE TABLE IF NOT EXISTS `mailbox_sync` (
	`mailbox` text PRIMARY KEY NOT NULL,
	`last_uid` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`last_error` text
);
