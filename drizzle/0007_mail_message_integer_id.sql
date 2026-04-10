DROP TABLE IF EXISTS `mail_message`;
--> statement-breakpoint
CREATE TABLE `mail_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mailbox` text NOT NULL,
	`uid` integer NOT NULL,
	`message_id` text,
	`subject` text DEFAULT '' NOT NULL,
	`from` text DEFAULT '' NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`preview` text DEFAULT '' NOT NULL,
	`text_content` text DEFAULT '' NOT NULL,
	`html_content` text,
	`flags` text DEFAULT '[]' NOT NULL,
	`received_at` integer,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_message_mailbox_uid_idx` ON `mail_message` (`mailbox`,`uid`);
