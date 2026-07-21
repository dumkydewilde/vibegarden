PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `projects_owner_matches_artifacts_and_uploads_on_update`;--> statement-breakpoint
CREATE TABLE `__old_artifact_upload_files` AS SELECT * FROM `artifact_upload_files`;--> statement-breakpoint
DROP TABLE `artifact_upload_files`;--> statement-breakpoint
CREATE TABLE `__new_artifact_uploads` (
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
	CONSTRAINT "artifact_uploads_type_check" CHECK(`type` in ('html', 'file', 'link')),
	CONSTRAINT "artifact_uploads_source_check" CHECK(`source` in ('web', 'mcp')),
	CONSTRAINT "artifact_uploads_status_check" CHECK(`status` in ('pending', 'finalizing', 'complete', 'failed', 'aborted', 'cleaning'))
);
--> statement-breakpoint
INSERT INTO `__new_artifact_uploads`("id", "user_id", "artifact_id", "version_id", "project_id", "project_draft_title", "project_draft_one_liner", "type", "title", "description", "allowed_data_origins", "source", "status", "idempotency_key", "expires_at", "created_at", "updated_at") SELECT "id", "user_id", "artifact_id", "version_id", "project_id", "project_draft_title", "project_draft_one_liner", "type", "title", "description", "allowed_data_origins", "source", "status", "idempotency_key", "expires_at", "created_at", "updated_at" FROM `artifact_uploads`;--> statement-breakpoint
DROP TABLE `artifact_uploads`;--> statement-breakpoint
ALTER TABLE `__new_artifact_uploads` RENAME TO `artifact_uploads`;--> statement-breakpoint
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
INSERT INTO `artifact_upload_files`("upload_id", "path", "r2_key", "mime_type", "byte_size", "sha256", "created_at") SELECT "upload_id", "path", "r2_key", "mime_type", "byte_size", "sha256", "created_at" FROM `__old_artifact_upload_files`;--> statement-breakpoint
DROP TABLE `__old_artifact_upload_files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_uploads_user_idempotency_unique` ON `artifact_uploads` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `artifact_uploads_expiry_idx` ON `artifact_uploads` (`expires_at`,`status`);--> statement-breakpoint
CREATE TRIGGER `artifact_uploads_project_owner_on_insert`
BEFORE INSERT ON `artifact_uploads`
FOR EACH ROW WHEN NEW.`project_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'upload project must belong to upload user');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_uploads_project_owner_on_update`
BEFORE UPDATE OF `user_id`, `project_id`, `status` ON `artifact_uploads`
FOR EACH ROW WHEN NEW.`project_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'upload project must belong to upload user');
END;
--> statement-breakpoint
CREATE TRIGGER `projects_owner_matches_artifacts_and_uploads_on_update`
BEFORE UPDATE OF `user_id` ON `projects`
FOR EACH ROW WHEN
  EXISTS (
    SELECT 1
    FROM `artifacts`
    WHERE `project_id` = OLD.`id` AND `user_id` IS NOT NEW.`user_id`
  )
  OR EXISTS (
    SELECT 1
    FROM `artifact_uploads`
    WHERE `project_id` = OLD.`id` AND `user_id` IS NOT NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'project owner must match attached artifact and upload users');
END;
--> statement-breakpoint
ALTER TABLE `artifacts` ADD `cleanup_started_at` integer;
