SELECT 'count:clubs' AS check_name, COUNT(*) AS value FROM clubs
UNION ALL SELECT 'count:club_memberships', COUNT(*) FROM club_memberships
UNION ALL SELECT 'count:club_invitations', COUNT(*) FROM club_invitations
UNION ALL SELECT 'count:projects_without_club', COUNT(*) FROM projects WHERE club_id IS NULL
UNION ALL SELECT 'count:chat_threads_without_club', COUNT(*) FROM chat_threads WHERE club_id IS NULL
UNION ALL SELECT 'count:questionnaire_responses_without_club', COUNT(*) FROM questionnaire_responses WHERE club_id IS NULL
UNION ALL SELECT 'count:comments_without_club', COUNT(*) FROM comments WHERE club_id IS NULL
UNION ALL SELECT 'count:site_feedback_without_club', COUNT(*) FROM site_feedback WHERE club_id IS NULL;

SELECT 'violation:null_tenant' AS violation
WHERE EXISTS (SELECT 1 FROM projects WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM chat_threads WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM questionnaire_responses WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM comments WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM site_feedback WHERE club_id IS NULL)
   OR EXISTS (SELECT 1 FROM club_invitations WHERE club_id IS NULL)
UNION ALL
SELECT 'violation:missing_membership'
WHERE EXISTS (
  SELECT 1 FROM users
  WHERE NOT EXISTS (
    SELECT 1 FROM club_memberships
    WHERE club_memberships.club_id = 'club_wotf'
      AND club_memberships.user_id = users.id
  )
)
UNION ALL
SELECT 'violation:owner_count'
WHERE (SELECT COUNT(*) FROM club_memberships WHERE club_id = 'club_wotf' AND role = 'owner') != 1
UNION ALL
SELECT 'violation:broken_foreign_key'
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check)
UNION ALL
SELECT 'violation:unmigrated_invite'
WHERE EXISTS (
  SELECT 1 FROM invites
  WHERE NOT EXISTS (
    SELECT 1 FROM club_invitations
    WHERE club_id = 'club_wotf'
      AND email = lower(invites.email)
  )
)
UNION ALL
-- D1 SQL cannot read deployed Worker variables. The focused source test keeps
-- this fixed WOTF bootstrap identity synchronized with wrangler.jsonc ADMIN_EMAIL.
SELECT 'violation:expected_wotf_owner_missing'
WHERE NOT EXISTS (
  SELECT 1 FROM users
  WHERE lower(email) = 'dumky@motherduck.com'
    AND platform_role = 'super_admin'
);
