DROP TABLE IF EXISTS `mail_message`;
--> statement-breakpoint
CREATE TABLE `mail_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`from` text DEFAULT '' NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`preview` text DEFAULT '' NOT NULL,
	`text_content` text DEFAULT '' NOT NULL,
	`html_content` text,
	`received_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_message_message_id_idx` ON `mail_message` (`message_id`);
--> statement-breakpoint
CREATE TABLE `mail_message_mailbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`mailbox` text NOT NULL,
	`uid` integer NOT NULL,
	`flags` text DEFAULT '[]' NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_message_mailbox_mailbox_uid_idx` ON `mail_message_mailbox` (`mailbox`, `uid`);
--> statement-breakpoint
CREATE INDEX `mail_message_mailbox_message_id_idx` ON `mail_message_mailbox` (`message_id`);
