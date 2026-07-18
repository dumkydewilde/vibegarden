CREATE TRIGGER `artifacts_project_owner_on_insert`
BEFORE INSERT ON `artifacts`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'artifact project must belong to artifact user');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_project_owner_on_update`
BEFORE UPDATE OF `user_id`, `project_id` ON `artifacts`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'artifact project must belong to artifact user');
END;
--> statement-breakpoint
CREATE TRIGGER `projects_owner_matches_artifacts_on_update`
BEFORE UPDATE OF `user_id` ON `projects`
FOR EACH ROW WHEN EXISTS (
  SELECT 1
  FROM `artifacts`
  WHERE `project_id` = OLD.`id` AND `user_id` IS NOT NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project owner must match attached artifact users');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_uploads_project_owner_on_insert`
BEFORE INSERT ON `artifact_uploads`
FOR EACH ROW WHEN NEW.`status` = 'pending' AND NEW.`project_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'pending upload project must belong to upload user');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_uploads_project_owner_on_update`
BEFORE UPDATE OF `user_id`, `project_id`, `status` ON `artifact_uploads`
FOR EACH ROW WHEN NEW.`status` = 'pending' AND NEW.`project_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'pending upload project must belong to upload user');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_private_on_insert`
BEFORE INSERT ON `artifacts`
FOR EACH ROW WHEN NEW.`visibility` != 'private'
BEGIN
  SELECT RAISE(ABORT, 'artifacts must be created private');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_type_immutable`
BEFORE UPDATE OF `type` ON `artifacts`
FOR EACH ROW WHEN NEW.`type` IS NOT OLD.`type`
BEGIN
  SELECT RAISE(ABORT, 'artifact type is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_project_immutable`
BEFORE UPDATE OF `project_id` ON `artifacts`
FOR EACH ROW WHEN NEW.`project_id` IS NOT OLD.`project_id`
BEGIN
  SELECT RAISE(ABORT, 'artifact project is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_current_version_matches_on_insert`
BEFORE INSERT ON `artifacts`
FOR EACH ROW WHEN NEW.`current_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `artifact_versions`
  WHERE `id` = NEW.`current_version_id` AND `artifact_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'current version must belong to artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_current_version_matches_on_update`
BEFORE UPDATE OF `current_version_id` ON `artifacts`
FOR EACH ROW WHEN NEW.`current_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `artifact_versions`
  WHERE `id` = NEW.`current_version_id` AND `artifact_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'current version must belong to artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_gallery_version_matches_on_insert`
BEFORE INSERT ON `artifacts`
FOR EACH ROW WHEN NEW.`gallery_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `artifact_versions`
  WHERE `id` = NEW.`gallery_version_id` AND `artifact_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'gallery version must belong to artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_gallery_version_matches_on_update`
BEFORE UPDATE OF `gallery_version_id` ON `artifacts`
FOR EACH ROW WHEN NEW.`gallery_version_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `artifact_versions`
  WHERE `id` = NEW.`gallery_version_id` AND `artifact_id` = NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'gallery version must belong to artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_versions_immutable`
BEFORE UPDATE ON `artifact_versions`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'artifact versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_files_immutable`
BEFORE UPDATE ON `artifact_files`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'artifact files are immutable');
END;
