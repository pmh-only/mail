CREATE INDEX "mail_message_search_idx" ON "mail_message" USING gin (to_tsvector('simple', left("subject" || ' ' || "from" || ' ' || "to" || ' ' || "text_content", 100000)));
