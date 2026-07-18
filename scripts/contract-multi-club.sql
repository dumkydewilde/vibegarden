PRAGMA foreign_keys=OFF;

INSERT INTO club_invitations (
  id, club_id, email, status, invited_by, created_at, updated_at, accepted_at
)
SELECT
  'legacy:' || lower(invites.email),
  'club_wotf',
  lower(invites.email),
  invites.status,
  (SELECT users.id FROM users WHERE lower(users.email) = lower(invites.invited_by)),
  invites.created_at,
  invites.created_at,
  CASE WHEN invites.status = 'joined' THEN invites.created_at ELSE NULL END
FROM invites
WHERE true
ON CONFLICT(club_id, email) DO UPDATE SET
  status = excluded.status,
  invited_by = excluded.invited_by,
  updated_at = excluded.updated_at,
  accepted_at = excluded.accepted_at;

CREATE TABLE `projects_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `club_id` text NOT NULL,
  `title` text NOT NULL,
  `one_liner` text,
  `modules` text,
  `status` text DEFAULT 'seed' NOT NULL,
  `thread_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `projects_new` SELECT id, user_id, club_id, title, one_liner, modules, status, thread_id, created_at, updated_at FROM projects;
DROP TABLE `projects`;
ALTER TABLE `projects_new` RENAME TO `projects`;
CREATE INDEX `projects_club_id_idx` ON `projects` (`club_id`);

CREATE TABLE `chat_threads_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `title` text,
  `project_id` text,
  `club_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `chat_threads_new` SELECT id, user_id, title, project_id, club_id, created_at, updated_at FROM chat_threads;
DROP TABLE `chat_threads`;
ALTER TABLE `chat_threads_new` RENAME TO `chat_threads`;
CREATE INDEX `chat_threads_club_id_idx` ON `chat_threads` (`club_id`);

CREATE TABLE `questionnaire_responses_new` (
  `club_id` text NOT NULL,
  `user_id` text NOT NULL,
  `answers` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`club_id`, `user_id`),
  FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `questionnaire_responses_new` SELECT club_id, user_id, answers, created_at FROM questionnaire_responses;
DROP TABLE `questionnaire_responses`;
ALTER TABLE `questionnaire_responses_new` RENAME TO `questionnaire_responses`;
CREATE INDEX `questionnaire_responses_club_id_idx` ON `questionnaire_responses` (`club_id`);

CREATE TABLE `comments_new` (
  `id` text PRIMARY KEY NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `user_id` text NOT NULL,
  `club_id` text NOT NULL,
  `parent_id` text,
  `body` text NOT NULL,
  `status` text DEFAULT 'visible' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `comments_new` SELECT id, target_type, target_id, user_id, club_id, parent_id, body, status, created_at, updated_at FROM comments;
DROP TABLE `comments`;
ALTER TABLE `comments_new` RENAME TO `comments`;
CREATE INDEX `comments_club_id_idx` ON `comments` (`club_id`);

CREATE TABLE `site_feedback_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `club_id` text NOT NULL,
  `page` text,
  `body` text NOT NULL,
  `status` text DEFAULT 'new' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `site_feedback_new` SELECT id, user_id, club_id, page, body, status, created_at FROM site_feedback;
DROP TABLE `site_feedback`;
ALTER TABLE `site_feedback_new` RENAME TO `site_feedback`;
CREATE INDEX `site_feedback_club_id_idx` ON `site_feedback` (`club_id`);

CREATE TABLE `club_invitations_new` (
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
INSERT INTO `club_invitations_new` SELECT id, club_id, email, status, invited_by, created_at, updated_at, accepted_at FROM club_invitations;
DROP TABLE `club_invitations`;
ALTER TABLE `club_invitations_new` RENAME TO `club_invitations`;
CREATE UNIQUE INDEX `club_invitations_club_id_email_unique` ON `club_invitations` (`club_id`, `email`);
CREATE INDEX `club_invitations_club_id_idx` ON `club_invitations` (`club_id`);

CREATE TABLE `users_new` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `name` text,
  `platform_role` text DEFAULT 'user' NOT NULL,
  `theme_pref` text,
  `last_club_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`last_club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `users_new` SELECT id, email, name, platform_role, theme_pref, last_club_id, created_at FROM users;
DROP TABLE `users`;
ALTER TABLE `users_new` RENAME TO `users`;
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

DROP TABLE `invites`;
PRAGMA foreign_keys=ON;
