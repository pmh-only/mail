CREATE UNIQUE INDEX IF NOT EXISTS `mail_message_mailbox_uid_idx` ON `mail_message` (`mailbox`, `uid`);
