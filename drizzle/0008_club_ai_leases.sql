ALTER TABLE `club_ai_credentials` ADD COLUMN `provisioning_lease_token` text;
--> statement-breakpoint
ALTER TABLE `club_ai_credentials` ADD COLUMN `provisioning_lease_heartbeat_at` integer;
