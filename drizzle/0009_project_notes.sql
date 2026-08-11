ALTER TABLE `projects` ADD COLUMN `notes` text;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `mcp_idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_mcp_idempotency_unique` ON `projects` (`user_id`,`club_id`,`mcp_idempotency_key`);
