ALTER TABLE `artifact_uploads` ADD `club_id` text REFERENCES clubs(id);
--> statement-breakpoint
CREATE INDEX `artifact_uploads_club_id_idx` ON `artifact_uploads` (`club_id`);
