CREATE TABLE `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`model_policy` text DEFAULT 'all_models' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`spending_limit_usd` integer,
	`spending_limit_reset` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_slug_unique` ON `clubs` (`slug`);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN platform_role text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN theme_pref text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_club_id text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN club_id text REFERENCES clubs(id);
--> statement-breakpoint
ALTER TABLE chat_threads ADD COLUMN club_id text REFERENCES clubs(id);
--> statement-breakpoint
ALTER TABLE comments ADD COLUMN club_id text REFERENCES clubs(id);
--> statement-breakpoint
ALTER TABLE site_feedback ADD COLUMN club_id text REFERENCES clubs(id);
--> statement-breakpoint
CREATE TABLE `club_memberships` (
	`club_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`onboarding_stage` text DEFAULT 'invited' NOT NULL,
	`model_pref` text,
	`joined_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`club_id`, `user_id`),
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_memberships_club_id_idx` ON `club_memberships` (`club_id`);
--> statement-breakpoint
CREATE INDEX `club_memberships_user_id_idx` ON `club_memberships` (`user_id`);
--> statement-breakpoint
CREATE TABLE `club_slug_aliases` (
	`slug` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_slug_aliases_club_id_idx` ON `club_slug_aliases` (`club_id`);
--> statement-breakpoint
CREATE TABLE `club_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_invitations_club_id_email_unique` ON `club_invitations` (`club_id`, `email`);
--> statement-breakpoint
CREATE INDEX `club_invitations_club_id_idx` ON `club_invitations` (`club_id`);
--> statement-breakpoint
CREATE TABLE `club_invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`max_joins` integer,
	`current_joins` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_invite_links_token_hash_unique` ON `club_invite_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `club_invite_links_club_id_idx` ON `club_invite_links` (`club_id`);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`club_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_club_id_idx` ON `audit_events` (`club_id`);
--> statement-breakpoint
CREATE TABLE `club_ai_credentials` (
	`club_id` text PRIMARY KEY NOT NULL,
	`key_hash` text,
	`key_suffix` text,
	`remote_workspace_id` text,
	`remote_guardrail_id` text,
	`ciphertext` text,
	`iv` text,
	`key_version` integer DEFAULT 1 NOT NULL,
	`provisioning_state` text DEFAULT 'pending' NOT NULL,
	`synced_policy` text,
	`last_attempt_at` integer,
	`last_synced_at` integer,
	`sanitized_error` text,
	`candidate_key_hash` text,
	`candidate_key_suffix` text,
	`candidate_ciphertext` text,
	`candidate_iv` text,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_ai_credentials_club_id_idx` ON `club_ai_credentials` (`club_id`);
--> statement-breakpoint
CREATE TABLE `ai_reconciliation_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`kind` text NOT NULL,
	`remote_id` text,
	`status` text NOT NULL,
	`metadata` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_reconciliation_findings_club_id_idx` ON `ai_reconciliation_findings` (`club_id`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `questionnaire_responses_new` (
	`club_id` text DEFAULT 'club_wotf',
	`user_id` text NOT NULL,
	`answers` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`club_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `questionnaire_responses_new` (`user_id`, `answers`, `created_at`)
SELECT `user_id`, `answers`, `created_at` FROM `questionnaire_responses`;
--> statement-breakpoint
DROP TABLE `questionnaire_responses`;
--> statement-breakpoint
ALTER TABLE `questionnaire_responses_new` RENAME TO `questionnaire_responses`;
--> statement-breakpoint
CREATE INDEX `projects_club_id_idx` ON `projects` (`club_id`);
--> statement-breakpoint
CREATE INDEX `chat_threads_club_id_idx` ON `chat_threads` (`club_id`);
--> statement-breakpoint
CREATE INDEX `questionnaire_responses_club_id_idx` ON `questionnaire_responses` (`club_id`);
--> statement-breakpoint
CREATE INDEX `comments_club_id_idx` ON `comments` (`club_id`);
--> statement-breakpoint
CREATE INDEX `site_feedback_club_id_idx` ON `site_feedback` (`club_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
