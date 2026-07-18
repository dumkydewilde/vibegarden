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
