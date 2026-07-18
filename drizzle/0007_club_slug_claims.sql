CREATE TABLE `club_slug_claims` (
	`slug` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_slug_claims_club_id_idx` ON `club_slug_claims` (`club_id`);
--> statement-breakpoint
INSERT INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
SELECT `slug`, `id`, `created_at` FROM `clubs`;
--> statement-breakpoint
INSERT INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
SELECT `slug`, `club_id`, `created_at` FROM `club_slug_aliases`;
--> statement-breakpoint
CREATE TRIGGER `club_slug_claim_on_club_insert`
AFTER INSERT ON `clubs`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `club_slug_claims`
    WHERE `slug` = NEW.`slug` AND `club_id` != NEW.`id`
  ) THEN RAISE(ABORT, 'club slug is already claimed') END;
  INSERT INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
  SELECT NEW.`slug`, NEW.`id`, NEW.`created_at`
  WHERE NOT EXISTS (
    SELECT 1 FROM `club_slug_claims` WHERE `slug` = NEW.`slug`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `club_slug_claim_on_club_slug_update`
AFTER UPDATE OF `slug` ON `clubs`
WHEN NEW.`slug` != OLD.`slug`
BEGIN
  INSERT INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
  VALUES (NEW.`slug`, NEW.`id`, NEW.`updated_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `club_slug_claim_on_alias_insert`
AFTER INSERT ON `club_slug_aliases`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `club_slug_claims`
    WHERE `slug` = NEW.`slug` AND `club_id` != NEW.`club_id`
  ) THEN RAISE(ABORT, 'club slug is already claimed') END;
  INSERT INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
  SELECT NEW.`slug`, NEW.`club_id`, NEW.`created_at`
  WHERE NOT EXISTS (
    SELECT 1 FROM `club_slug_claims` WHERE `slug` = NEW.`slug`
  );
END;
