CREATE TABLE `artifact_files` (
	`version_id` text NOT NULL,
	`path` text NOT NULL,
	`r2_key` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_files_byte_size_check" CHECK("artifact_files"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_files_version_path_unique` ON `artifact_files` (`version_id`,`path`);--> statement-breakpoint
CREATE TABLE `artifact_idempotency` (
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`target_key` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`artifact_id` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_idempotency_scope_unique` ON `artifact_idempotency` (`user_id`,`operation`,`target_key`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `artifact_object_leases` (
	`r2_key` text PRIMARY KEY NOT NULL,
	`upload_id` text,
	`user_id` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "artifact_object_leases_byte_size_check" CHECK("artifact_object_leases"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX `artifact_object_leases_expiry_idx` ON `artifact_object_leases` (`expires_at`);--> statement-breakpoint
CREATE TABLE `artifact_upload_files` (
	`upload_id` text NOT NULL,
	`path` text NOT NULL,
	`r2_key` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `artifact_uploads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_upload_files_byte_size_check" CHECK("artifact_upload_files"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_upload_files_upload_path_unique` ON `artifact_upload_files` (`upload_id`,`path`);--> statement-breakpoint
CREATE TABLE `artifact_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`version_id` text NOT NULL,
	`project_id` text,
	`project_draft_title` text,
	`project_draft_one_liner` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`allowed_data_origins` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "artifact_uploads_type_check" CHECK("artifact_uploads"."type" in ('html', 'file', 'link')),
	CONSTRAINT "artifact_uploads_source_check" CHECK("artifact_uploads"."source" in ('web', 'mcp')),
	CONSTRAINT "artifact_uploads_status_check" CHECK("artifact_uploads"."status" in ('pending', 'finalizing', 'complete', 'failed', 'aborted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_uploads_user_idempotency_unique` ON `artifact_uploads` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `artifact_uploads_expiry_idx` ON `artifact_uploads` (`expires_at`,`status`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`source` text NOT NULL,
	`entry_path` text,
	`external_url` text,
	`allowed_data_origins` text DEFAULT '[]' NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "artifact_versions_source_check" CHECK("artifact_versions"."source" in ('web', 'mcp')),
	CONSTRAINT "artifact_versions_version_number_check" CHECK("artifact_versions"."version_number" >= 1),
	CONSTRAINT "artifact_versions_file_count_check" CHECK("artifact_versions"."file_count" >= 0),
	CONSTRAINT "artifact_versions_total_bytes_check" CHECK("artifact_versions"."total_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_versions_artifact_number_unique` ON `artifact_versions` (`artifact_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`current_version_id` text,
	`gallery_version_id` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gallery_version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "artifacts_type_check" CHECK("artifacts"."type" in ('html', 'file', 'link')),
	CONSTRAINT "artifacts_visibility_check" CHECK("artifacts"."visibility" in ('private', 'gallery', 'public'))
);
--> statement-breakpoint
CREATE INDEX `artifacts_owner_list_idx` ON `artifacts` (`user_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `artifacts_gallery_idx` ON `artifacts` (`visibility`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `artifacts_cleanup_idx` ON `artifacts` (`deleted_at`);