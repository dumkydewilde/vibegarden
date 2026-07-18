INSERT INTO clubs (
  id, name, slug, model_policy, status, spending_limit_usd,
  spending_limit_reset, created_by, created_at, updated_at, archived_at
)
SELECT
  'club_wotf', 'WOTF Club', 'wotf', 'all_models', 'active', NULL,
  NULL, id, created_at, CAST(strftime('%s', 'now') AS integer) * 1000, NULL
FROM users
WHERE lower(email) = 'dumky@motherduck.com'
ON CONFLICT(id) DO NOTHING;

UPDATE users
SET platform_role = CASE
  WHEN lower(email) = 'dumky@motherduck.com' THEN 'super_admin'
  ELSE platform_role
END,
last_club_id = COALESCE(last_club_id, 'club_wotf');

INSERT INTO club_memberships (
  club_id, user_id, role, onboarding_stage, model_pref, joined_at, updated_at
)
SELECT 'club_wotf', id,
  CASE WHEN lower(email) = 'dumky@motherduck.com' THEN 'owner' ELSE 'member' END,
  stage, model_pref, created_at, created_at
FROM users
WHERE true
ON CONFLICT(club_id, user_id) DO NOTHING;

UPDATE projects SET club_id = 'club_wotf' WHERE club_id IS NULL;
UPDATE chat_threads SET club_id = 'club_wotf' WHERE club_id IS NULL;
UPDATE questionnaire_responses SET club_id = 'club_wotf' WHERE club_id IS NULL;
UPDATE comments SET club_id = 'club_wotf' WHERE club_id IS NULL;
UPDATE site_feedback SET club_id = 'club_wotf' WHERE club_id IS NULL;

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
ON CONFLICT(club_id, email) DO NOTHING;

INSERT INTO club_ai_credentials (
  club_id, provisioning_state, synced_policy, key_version,
  last_attempt_at, last_synced_at
)
VALUES ('club_wotf', 'pending', NULL, 1, NULL, NULL)
ON CONFLICT(club_id) DO NOTHING;
