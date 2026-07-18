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
INSERT OR IGNORE INTO `club_slug_claims` (`slug`, `club_id`, `created_at`)
SELECT `slug`, `club_id`, `created_at` FROM `club_slug_aliases`;
