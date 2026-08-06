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
CREATE INDEX `agents_shared_list_idx` ON `agents` (`club_id`,`visibility`,`deleted_at`,`updated_at`);
