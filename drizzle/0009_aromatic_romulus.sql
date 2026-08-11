CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`definition` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `agent_versions_agent_idx` ON `agent_versions` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`latest_version_id` text,
	`shared_version_id` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`latest_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shared_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agents_visibility_check" CHECK("agents"."visibility" in ('private', 'club'))
);
--> statement-breakpoint
CREATE INDEX `agents_owner_list_idx` ON `agents` (`club_id`,`owner_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agents_shared_list_idx` ON `agents` (`club_id`,`visibility`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `agent_versions_immutable`
BEFORE UPDATE ON `agent_versions`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'agent versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `agents_latest_version_matches_on_insert`
BEFORE INSERT ON `agents`
FOR EACH ROW WHEN NEW.`latest_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `agent_versions`
  WHERE `id` = NEW.`latest_version_id` AND `agent_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'latest version must belong to agent');
END;
--> statement-breakpoint
CREATE TRIGGER `agents_latest_version_matches_on_update`
BEFORE UPDATE OF `latest_version_id` ON `agents`
FOR EACH ROW WHEN NEW.`latest_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `agent_versions`
  WHERE `id` = NEW.`latest_version_id` AND `agent_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'latest version must belong to agent');
END;
--> statement-breakpoint
CREATE TRIGGER `agents_shared_version_matches_on_insert`
BEFORE INSERT ON `agents`
FOR EACH ROW WHEN NEW.`shared_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `agent_versions`
  WHERE `id` = NEW.`shared_version_id` AND `agent_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'shared version must belong to agent');
END;
--> statement-breakpoint
CREATE TRIGGER `agents_shared_version_matches_on_update`
BEFORE UPDATE OF `shared_version_id` ON `agents`
FOR EACH ROW WHEN NEW.`shared_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `agent_versions`
  WHERE `id` = NEW.`shared_version_id` AND `agent_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'shared version must belong to agent');
END;
