# Multi-club production rollout

This runbook mutates Cloudflare D1, Worker secrets and deployments, and
OpenRouter resources. Do not execute any live step without explicit user
authorization naming the target environment.

This document records commands for review. It does not authorize their
execution. Production authorization does not authorize a staging OpenRouter
workspace, and staging authorization does not authorize production.

## Preconditions

1. Confirm the target D1 database is `vibe-garden`, the Worker is
   `vibe-garden`, and record the exact OpenRouter workspace ID in the change
   record. Stop if any target differs from the authorization.
2. Run the local gate from the repository checkout:

   ```sh
   npm run test:all
   npm run typecheck
   npm run build
   npm run db:migrate
   npx wrangler d1 execute DB --local --file scripts/backfill-wotf.sql
   npx wrangler d1 execute DB --local --file scripts/verify-multi-club-migration.sql
   ```

   Expected: every test passes, the build succeeds, and the verification
   output contains counts only, with no `violation:` row. For an empty local
   D1 database, use the migration-history tests as the local proof; the
   backfill requires the configured admin account to exist before it can make
   WOTF and its credential.
3. Confirm the configured bootstrap admin has logged in before the remote
   backfill. The read-only check below must return exactly one row. Stop if it
   does not.

   ```sh
   npx wrangler d1 execute vibe-garden --remote --command "SELECT id, email FROM users WHERE lower(email) = 'dumky@motherduck.com';"
   ```

## Gate 1: backup and recovery point

After explicit production authorization, create a local, gitignored backup
directory and capture both a SQL export and the current D1 bookmark:

```sh
mkdir -p .context/backups
npx wrangler d1 export vibe-garden --remote --output=.context/backups/vibe-garden-pre-multi-club.sql
npx wrangler d1 time-travel info vibe-garden
npx wrangler deployments list --name vibe-garden
```

Expected: the export finishes successfully, `time-travel info` prints a current
bookmark, and the deployment list identifies the currently active version.
Record the bookmark and deployment/version ID in `.context`, never in Git.
Do not put the export, credentials, key material, or invitation URLs in the
repository.

Stop here if the backup or bookmark is missing. D1 Time Travel only retains
bookmarks for its configured retention period, so complete or roll back the
change within that window.

## Gate 2: expand and backfill

Apply the additive migrations and run the idempotent WOTF data backfill:

```sh
npx wrangler d1 migrations apply vibe-garden --remote
npx wrangler d1 execute vibe-garden --remote --file scripts/backfill-wotf.sql
npx wrangler d1 execute vibe-garden --remote --file scripts/verify-multi-club-migration.sql
```

Expected: all current migrations apply; WOTF owns every legacy row; each user
has a WOTF membership; and `dumky@motherduck.com` is the sole WOTF owner and a
super admin. The verification query may print count rows, but must print no
`violation:` row.

Stop before deploying if a migration, backfill, or invariant check fails.

## Gate 3: secrets and club-aware deployment

Set the two new secrets without echoing values to a terminal or shell history.
Generate the credential-encryption key once, save it in the approved secret
manager, and retain it for as long as its encrypted D1 records exist.

```sh
npx wrangler secret put OPENROUTER_MANAGEMENT_KEY --name vibe-garden
openssl rand -base64 32 | npx wrangler secret put OPENROUTER_CREDENTIAL_KEY_V1 --name vibe-garden
printf '%s' true | npx wrangler secret put ALLOW_WOTF_LEGACY_KEY --name vibe-garden
npm run deploy
```

Expected: each secret command confirms an update and the deploy returns a new
Worker deployment/version. The legacy key remains available only for WOTF when
its dedicated credential is not ready; no other club can use it.

Verify all of the following before continuing:

- legacy paths redirect into `/clubs/wotf`;
- WOTF onboarding and club-admin views load;
- unknown, archived, unauthorized, and cross-club routes return the same 404;
- members of multiple clubs see isolated onboarding, model choice, projects,
  conversations, comments, feedback, and access controls;
- the club switcher updates `last_club_id`, opens club home, works by keyboard,
  and mobile dialogs/sheets retain focus and show textual role/status labels.

Stop and roll back if any authorization or tenant-isolation check fails.

## Gate 4: separately approved OpenRouter staging smoke test

This gate needs a separate authorization that names a non-production OpenRouter
workspace. In that workspace, create a temporary club and verify:

1. a dedicated key is created;
2. the shared free-only guardrail is assigned;
3. one allowlisted free-model request succeeds;
4. a paid-model request is rejected; and
5. the temporary credential is disabled or cleaned up.

Also verify that a zero-dollar key limit still permits the allowlisted free
request before using that defense in production. Stop if the provider behavior
does not match all five checks. Do not copy a staging key into production.

## Gate 5: provision WOTF and remove its fallback

From `/admin/clubs`, trigger the WOTF retry. Confirm `ready` status, a
guardrail assignment, and one successful Gardener request. Then remove the
fallback in a new deployment:

```sh
printf '%s' false | npx wrangler secret put ALLOW_WOTF_LEGACY_KEY --name vibe-garden
npm run deploy
npx wrangler secret delete OPENROUTER_API_KEY --name vibe-garden
```

Expected: WOTF uses only its dedicated credential and the old key no longer
exists. Run this only after logs and the provider dashboard confirm successful
WOTF traffic. Stop before deleting `OPENROUTER_API_KEY` if the dedicated key is
not ready or any Gardener request fails.

## Gate 6: contract after stable production verification

Do not run this gate until the expanded deployment has remained stable and all
earlier verification has passed. The committed migrations already occupy
`0007` and `0008`; promote the reviewed contract as the next migration,
`0009_multi_club_contract.sql`, rather than renumbering existing migrations.

```sh
git mv scripts/contract-multi-club.sql drizzle/0009_multi_club_contract.sql
npm run test:all
npm run typecheck
npm run build
npx wrangler d1 migrations apply vibe-garden --remote
npx wrangler d1 execute vibe-garden --remote --file scripts/verify-multi-club-migration.sql
```

Expected: club-owned tenant columns are required; `users.role`, `users.stage`,
`users.model_pref`, and legacy `invites` are absent; and verification prints no
violation row. Only then update the roadmap to complete and commit the contract
and schema shape together.

## Rollback

Stop application writes, record the current deployment/version and post-change
bookmark, then restore the pre-rollout D1 bookmark captured in Gate 1:

```sh
npx wrangler rollback <pre-rollout-version-id> --name vibe-garden
npx wrangler d1 time-travel restore vibe-garden --bookmark=<pre-multi-club-bookmark>
```

Both commands mutate production and need the same explicit authorization. D1
restore overwrites the database in place and cancels in-flight queries. Record
the `previous_bookmark` printed by the restore; it is the command's undo point
if the rollback itself must be reversed. Re-run the read-only invariant query
and smoke checks after rollback. Do not import the SQL export casually; retain
it as an additional recovery artifact and use the approved D1 recovery process
if the Time Travel retention window has passed.

## Security and operational notes

- `OPENROUTER_MANAGEMENT_KEY` is server-only. `OPENROUTER_CREDENTIAL_KEY_V1`
  must be a base64-encoded 32-byte AES-GCM key.
- `OPENROUTER_WORKSPACE_ID` identifies the workspace for club-managed keys.
- The Worker reconciliation cron runs at minute 17 of every hour (UTC). It
  records sanitized findings and must not include provider secrets, raw invite
  tokens, chat content, or questionnaire answers in logs.
- D1 stores encrypted OpenRouter credentials and hashed invitation tokens.
  Plaintext OpenRouter keys and raw invitation tokens are not recoverable from
  D1.
