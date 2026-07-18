SELECT 'count:clubs' AS check_name, COUNT(*) AS value FROM clubs;
SELECT 'count:club_memberships' AS check_name, COUNT(*) AS value FROM club_memberships;
SELECT 'count:club_invitations' AS check_name, COUNT(*) AS value FROM club_invitations;
SELECT 'count:projects_without_club' AS check_name, COUNT(*) AS value FROM projects WHERE club_id IS NULL;
SELECT 'count:chat_threads_without_club' AS check_name, COUNT(*) AS value FROM chat_threads WHERE club_id IS NULL;
SELECT 'count:questionnaire_responses_without_club' AS check_name, COUNT(*) AS value FROM questionnaire_responses WHERE club_id IS NULL;
SELECT 'count:comments_without_club' AS check_name, COUNT(*) AS value FROM comments WHERE club_id IS NULL;
SELECT 'count:site_feedback_without_club' AS check_name, COUNT(*) AS value FROM site_feedback WHERE club_id IS NULL;

SELECT 'violation:null_tenant' AS violation
WHERE EXISTS (SELECT 1 FROM projects WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM chat_threads WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM questionnaire_responses WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM comments WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM site_feedback WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM club_invitations WHERE club_id IS NULL);

SELECT 'violation:missing_membership' AS violation
WHERE EXISTS (
  SELECT 1 FROM users
  WHERE NOT EXISTS (
    SELECT 1 FROM club_memberships
    WHERE club_memberships.club_id = 'club_wotf'
      AND club_memberships.user_id = users.id
  )
);

SELECT 'violation:owner_count' AS violation
WHERE (SELECT COUNT(*) FROM club_memberships WHERE club_id = 'club_wotf' AND role = 'owner') != 1;

SELECT 'violation:broken_foreign_key' AS violation
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

SELECT 'violation:unmigrated_invite' AS violation
WHERE EXISTS (
  SELECT 1 FROM invites
  WHERE NOT EXISTS (
    SELECT 1 FROM club_invitations
    WHERE club_id = 'club_wotf'
      AND email = lower(invites.email)
  )
);

-- D1 SQL cannot read deployed Worker variables. The focused source test keeps
-- this fixed WOTF bootstrap identity synchronized with wrangler.jsonc ADMIN_EMAIL.
SELECT 'violation:expected_wotf_owner_missing' AS violation
WHERE NOT EXISTS (
  SELECT 1 FROM users
  WHERE lower(email) = 'dumky@motherduck.com'
    AND platform_role = 'super_admin'
);
