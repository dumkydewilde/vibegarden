# Multi-Club Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Vibe Garden into a multi-tenant application where a person can belong to multiple isolated clubs, with WOTF migrated in place and each club using a platform-managed OpenRouter credential.

**Architecture:** Keep one D1 database and make `club_id` the explicit tenant boundary at every storage and route boundary. Resolve a canonical `ClubContext` once per club request, pass it into club-owned services, and separate global account and platform administration from `/clubs/:clubSlug` routes. Provision and reconcile one encrypted OpenRouter credential per club outside the club-creation transaction so non-AI features remain available during provider failures.

**Tech Stack:** React Router 8 framework mode, React 19, Cloudflare Workers and D1, Drizzle ORM, Web Crypto AES-GCM, OpenRouter Management API and Guardrails API, Vitest 4, Cloudflare Workers Vitest integration, Testing Library.

## Global Constraints

- Club URLs are path-based under `/clubs/:clubSlug`; an active-club cookie is not an authorization source.
- Global roles are exactly `user` and `super_admin`; club roles are exactly `owner`, `admin`, and `member`.
- A club has exactly one owner. Only that owner can transfer ownership or archive the club.
- Super admins receive effective `admin` access to active clubs, but never implicit membership or owner authority.
- The design's global-dashboard reference to archival is interpreted as archived-status visibility plus restoration; the repeated permission rules remain authoritative that only an owner archives and only a super admin restores.
- New clubs start with `free_only`; only a super admin can grant `all_models`.
- Invitation-link expiry is limited to 1 hour, 24 hours, 7 days, or 30 days.
- Unknown clubs, unauthorized clubs, and cross-club object IDs return 404 from UI routes.
- Every club-owned collection query filters by `club_id`; every object query filters by both object ID and `club_id`.
- Raw OpenRouter keys, raw invitation tokens, chat content, and questionnaire answers never appear in logs or audit metadata.
- Initial or failed AI provisioning does not block non-AI club features and does block Gardener requests.
- The existing deployment becomes WOTF Club at `/clubs/wotf` with `all_models`, all current users and data, and the configured admin as owner and `super_admin`.
- Club archival is reversible; permanent deletion and bring-your-own OpenRouter keys are outside version one.
- Use D1 `batch()` for atomic multi-statement writes. D1 documents that a failed batched statement rolls back the sequence.
- Keep current React Router, Drizzle, Vitest, TypeScript, and Cloudflare dependency major versions unless a task names an added package.
- Preserve the repository copy rule: do not add em or en dashes to product copy.

Primary implementation references:

- [OpenRouter API key creation](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [OpenRouter guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview)
- [OpenRouter key-to-guardrail assignment](https://openrouter.ai/docs/api/api-reference/guardrails/bulk-assign-keys-to-guardrail)
- [Cloudflare D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

---

## File and Responsibility Map

### Database and rollout

- Modify `app/db/schema.ts`: final global, club, invitation, audit, credential, reconciliation, and club-owned table shapes.
- Create `drizzle/0006_multi_club_expand.sql`: additive tables, indexes, nullable tenant columns, and the questionnaire key expansion.
- Create `scripts/backfill-wotf.sql`: idempotent WOTF creation and data backfill.
- Create `scripts/verify-multi-club-migration.sql`: zero-row invariant checks and row-count reports.
- Create `scripts/contract-multi-club.sql`: table rebuilds that make tenant references required and remove legacy user fields. Promote it into `drizzle/0007_multi_club_contract.sql` only in the contract release.

### Tenant and membership domain

- Create `app/lib/club-path.ts`: slug parsing and canonical club URL construction, usable on server and client.
- Create `app/lib/club-permissions.ts`: pure role and permission predicates.
- Create `app/lib/clubs.server.ts`: club lookup, alias resolution, `ClubContext`, root destination, creation, settings, and last-club preference.
- Create `app/lib/memberships.server.ts`: role changes, leave/remove, ownership transfer, archive/restore, and audit writes.
- Modify `app/lib/auth.server.ts`, `app/lib/otp.server.ts`, and `app/routes/auth.google.callback.tsx`: global identity and club-invitation-aware sign-in.

### Invitations

- Replace the persistence portion of `app/lib/invites.server.ts`: club email invitations, link creation, hashing, validation, revocation, and atomic join.
- Modify `app/routes/join.tsx` into token-aware `/join/:token` behavior.

### Club-owned data

- Modify `app/lib/projects.server.ts`, `app/lib/threads.server.ts`, `app/lib/comments.server.ts`, and `app/lib/feedback.server.ts`: require explicit club scope.
- Modify `app/routes/welcome.tsx`, participant routes, admin routes, and resource routes: obtain scope from `requireClubContext`, never from user ID alone.

### Routes and interface

- Modify `app/routes.ts`: canonical club routes, global routes, resource routes, and legacy WOTF redirects.
- Modify `app/routes/app-layout.tsx`: resolve club context, membership onboarding, club-scoped Gardener history, and switcher data.
- Create `app/routes/settings.tsx`: global profile, club list, creation, and leave behavior.
- Create `app/routes/admin.clubs.tsx`: super-admin club operations.
- Create `app/routes/admin.members.tsx`, `app/routes/admin.invitations.tsx`, and `app/routes/admin.settings.tsx`: focused club administration.
- Create `app/routes/legacy.$section.tsx` and `app/routes/legacy.$section.$.tsx`: WOTF compatibility redirects.
- Create `app/components/shell/club-switcher.tsx` and `app/components/shell/global-page-shell.tsx`.
- Modify shell, navigation, content-link, feedback, and Gardener components to use canonical club paths.

### OpenRouter

- Create `app/lib/credential-crypto.server.ts`: versioned AES-GCM encryption and decryption.
- Create `app/lib/openrouter-management.server.ts`: typed Management API client.
- Create `app/lib/club-ai.server.ts`: provisioning, policy sync, credential resolution, rotation, disable/enable, and reconciliation.
- Modify `app/lib/models.ts` and `app/routes/api.chat.ts`: one shared policy decision for discovery and execution.
- Modify `workers/app.ts`, `wrangler.jsonc`, and `app/types/env.d.ts`: background provisioning, scheduled reconciliation, and secrets.

### Tests and documentation

- Create `vitest.d1.config.ts`, `vitest.migration.config.ts`, `test/d1/apply-migrations.ts`, `test/d1/env.d.ts`, and `test/d1/tsconfig.json`: real D1 integration tests in workerd, with migration-history tests isolated from automatic setup.
- Add focused `*.worker.test.ts` tenant, membership, invitation, migration, and AI lifecycle tests under `test/d1/`.
- Add route and component tests under existing `app/**/__tests__/` folders.
- Modify `docs/ROADMAP.md`, `README.md`, and `scripts/first-deploy.sh` only when the corresponding implementation and deployment steps land.

---

### Task 1: Add a real D1 integration-test lane

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.d1.config.ts`
- Create: `vitest.migration.config.ts`
- Create: `test/d1/apply-migrations.ts`
- Create: `test/d1/env.d.ts`
- Create: `test/d1/tsconfig.json`
- Create: `test/d1/d1-smoke.worker.test.ts`

**Interfaces:**
- Consumes: the `DB` binding and migration directory from `wrangler.jsonc`.
- Produces: `npm run test:d1` for tests that start at the current schema, plus `npm run test:migrations` for tests that control the baseline, expand, backfill, and contract boundaries themselves.

- [ ] **Step 1: Install the Workers Vitest integration and add scripts**

Run:

```bash
npm install --save-dev @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

Add these scripts to `package.json`:

```json
{
  "test:d1": "vitest run --config vitest.d1.config.ts",
  "test:migrations": "vitest run --config vitest.migration.config.ts",
  "test:all": "npm test && npm run test:d1 && npm run test:migrations"
}
```

- [ ] **Step 2: Configure workerd and apply migrations**

Create `vitest.d1.config.ts`:

```ts
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("drizzle")),
        },
      },
    })),
  ],
  test: {
    include: ["test/d1/**/*.worker.test.ts"],
    exclude: ["test/d1/migration.worker.test.ts"],
    setupFiles: ["./test/d1/apply-migrations.ts"],
  },
});
```

Create `test/d1/apply-migrations.ts`:

```ts
import { beforeAll } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
```

Declare `ProvidedEnv` with `DB: D1Database`, `TEST_MIGRATIONS: D1Migration[]`, `TEST_WOTF_BACKFILL_SQL: string`, and `TEST_CONTRACT_SQL: string` in `test/d1/env.d.ts`, and include `@cloudflare/vitest-pool-workers` plus `@cloudflare/workers-types` in `test/d1/tsconfig.json`.

- [ ] **Step 3: Add a migration-history config without automatic setup**

Create `vitest.migration.config.ts`:

```ts
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("drizzle")),
          TEST_WOTF_BACKFILL_SQL: "",
          TEST_CONTRACT_SQL: "",
        },
      },
    })),
  ],
  test: {
    include: ["test/d1/migration.worker.test.ts"],
    passWithNoTests: true,
  },
});
```

This config deliberately has no `setupFiles`, so the migration test receives an empty D1 database. Task 2 replaces the empty SQL bindings after those scripts exist.

- [ ] **Step 4: Prove the current-schema test binding works**

Create `test/d1/d1-smoke.worker.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";

test("applies the committed D1 schema", async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first<{ name: string }>();
  expect(row).toEqual({ name: "users" });
});
```

- [ ] **Step 5: Run all three test lanes**

Run: `npm run test:all`

Expected: existing jsdom tests pass, `d1-smoke.worker.test.ts` passes after automatic migrations, and the migration lane exits successfully with no test files until Task 2 adds its test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.d1.config.ts vitest.migration.config.ts test/d1
git commit -m "test: add D1 integration test lane"
```

### Task 2: Expand the schema and backfill WOTF

**Files:**
- Modify: `app/db/schema.ts`
- Modify for expand compatibility: `app/routes/welcome.tsx`
- Modify: `vitest.migration.config.ts`
- Create: `drizzle/0006_multi_club_expand.sql`
- Create: `scripts/backfill-wotf.sql`
- Create: `scripts/verify-multi-club-migration.sql`
- Create: `scripts/contract-multi-club.sql`
- Create: `test/d1/migration.worker.test.ts`

**Interfaces:**
- Consumes: `ADMIN_EMAIL` as the normalized bootstrap owner identity.
- Produces: `Club`, `ClubMembership`, `ClubInvitation`, `ClubInviteLink`, `ClubAiCredential`, `AuditEvent`, and `AiReconciliationFinding` Drizzle types; the stable WOTF ID `club_wotf` and slug `wotf`.

- [ ] **Step 1: Write the migration invariant test**

First replace the two empty SQL bindings in `vitest.migration.config.ts` and add the import:

```ts
import { readFile } from "node:fs/promises";

TEST_WOTF_BACKFILL_SQL: await readFile(
  path.resolve("scripts/backfill-wotf.sql"),
  "utf8",
),
TEST_CONTRACT_SQL: await readFile(
  path.resolve("scripts/contract-multi-club.sql"),
  "utf8",
),
```

In `test/d1/migration.worker.test.ts`, apply only migrations before `0006_multi_club_expand.sql`, seed two users, one invite, project, thread, questionnaire, comment, and feedback row using the pre-migration columns, then apply only the expand migration and execute the backfill:

```ts
import { applyD1Migrations, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("expands and backfills a populated single-club database", async () => {
  const expandName = "0006_multi_club_expand.sql";
  const baseline = env.TEST_MIGRATIONS.filter(
    (migration) => migration.name < expandName,
  );
  const expand = env.TEST_MIGRATIONS.find(
    (migration) => migration.name === expandName,
  );
  expect(expand).toBeDefined();

  await applyD1Migrations(env.DB, baseline);
  await seedLegacyDatabase(env.DB);
  await applyD1Migrations(env.DB, [expand!]);
  await env.DB.exec(env.TEST_WOTF_BACKFILL_SQL);

});
```

Define `seedLegacyDatabase(db: D1Database)` in the same file with explicit inserts for the seven seeded legacy records. The migration config has no automatic setup, so no current-schema table exists before `baseline` is applied. Then assert:

```ts
const owner = await env.DB.prepare(`
  SELECT COUNT(*) AS count
  FROM club_memberships
  WHERE club_id = 'club_wotf' AND role = 'owner'
`).first<{ count: number }>();
expect(owner?.count).toBe(1);

for (const table of [
  "projects",
  "chat_threads",
  "questionnaire_responses",
  "comments",
  "site_feedback",
  "club_invitations",
]) {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE club_id IS NULL`,
  ).first<{ count: number }>();
  expect(result?.count).toBe(0);
}
```

Execute `TEST_WOTF_BACKFILL_SQL` a second time and assert row counts do not change. Execute `TEST_CONTRACT_SQL` last and assert legacy user columns and the legacy `invites` table are absent while every tenant column is non-null.

- [ ] **Step 2: Add expanded schema types and indexes**

Define these exact enums and exports in `app/db/schema.ts`:

```ts
export type PlatformRole = "user" | "super_admin";
export type ClubRole = "owner" | "admin" | "member";
export type ClubStatus = "active" | "archived";
export type ModelPolicy = "free_only" | "all_models";
export type ProvisioningState = "pending" | "ready" | "failed" | "disabled";
export type OnboardingStage = "invited" | "questionnaire" | "exploring";
```

Add:

```ts
users: id, email, name, platformRole, themePref, lastClubId, createdAt
clubs: id, name, slug, modelPolicy, status, spendingLimitUsd,
       spendingLimitReset, createdBy, createdAt, updatedAt, archivedAt
clubMemberships: clubId, userId, role, onboardingStage, modelPref,
                 joinedAt, updatedAt
clubSlugAliases: slug, clubId, createdAt
clubInvitations: id, clubId, email, status, invitedBy, createdAt,
                 updatedAt, acceptedAt
clubInviteLinks: id, clubId, tokenHash, createdBy, createdAt, expiresAt,
                 maxJoins, currentJoins, revokedAt
auditEvents: id, actorUserId, clubId, action, targetType, targetId,
             metadata, createdAt
clubAiCredentials: clubId, keyHash, keySuffix, remoteWorkspaceId,
                   remoteGuardrailId, ciphertext, iv, keyVersion,
                   provisioningState, syncedPolicy, lastAttemptAt,
                   lastSyncedAt, sanitizedError, candidateKeyHash,
                   candidateKeySuffix, candidateCiphertext, candidateIv
aiReconciliationFindings: id, clubId, kind, remoteId, status, metadata,
                          firstSeenAt, lastSeenAt, resolvedAt
```

Keep the legacy `users.role`, `users.stage`, and `users.model_pref` fields plus nullable `clubId` properties in the expanded Drizzle shape so the compatibility deployment still typechecks. Mark them deprecated in comments. Use composite primary keys for `club_memberships` and `questionnaire_responses`, unique indexes for canonical slugs, alias slugs, `(club_id, email)`, and token hashes, and `club_id` indexes on every club-owned table. Task 14 removes the legacy fields and makes the Drizzle tenant properties non-null after the contract migration.

- [ ] **Step 3: Author the expand and idempotent backfill SQL**

`drizzle/0006_multi_club_expand.sql` must:

```sql
ALTER TABLE users ADD COLUMN platform_role text DEFAULT 'user' NOT NULL;
ALTER TABLE users ADD COLUMN last_club_id text;
ALTER TABLE projects ADD COLUMN club_id text REFERENCES clubs(id);
ALTER TABLE chat_threads ADD COLUMN club_id text REFERENCES clubs(id);
ALTER TABLE comments ADD COLUMN club_id text REFERENCES clubs(id);
ALTER TABLE site_feedback ADD COLUMN club_id text REFERENCES clubs(id);
```

Create the seven new domain tables plus `ai_reconciliation_findings`. Rebuild `questionnaire_responses` during expand with `club_id DEFAULT 'club_wotf'` and `PRIMARY KEY (club_id, user_id)` before multi-club onboarding begins. In the compatibility deployment, change the old welcome action to an untargeted SQLite upsert, `ON CONFLICT DO UPDATE SET answers = excluded.answers, created_at = excluded.created_at`, so it works both before and after the primary-key expansion. Keep legacy `users.role`, `users.stage`, `users.model_pref`, and `invites` intact during this release.

`scripts/backfill-wotf.sql` must use conflict-safe inserts and update only null tenant fields. The current configured bootstrap email is `dumky@motherduck.com`, so the runnable SQL uses that exact value and the verification script checks it against the deployed Wrangler configuration:

```sql
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
```

Keep credential secret and remote-ID columns nullable until provisioning succeeds. The verification query must fail if the configured admin email changes without an intentional update to this backfill.

- [ ] **Step 4: Add verification and contract scripts**

`scripts/verify-multi-club-migration.sql` must report counts and return a named violation row for null tenants, missing memberships, owner count other than one, broken foreign keys, or unmigrated invites. `scripts/contract-multi-club.sql` must rebuild all six club-owned tables with `club_id NOT NULL`, rebuild `users` without `role`, `stage`, or `model_pref`, and drop legacy `invites` only after copying its final state.

- [ ] **Step 5: Run migration tests and inspect generated schema**

Run:

```bash
npm run test:migrations
npm run typecheck
```

Expected: the backfill is idempotent, all seeded rows belong to `club_wotf`, WOTF has one owner, and TypeScript accepts the final schema.

- [ ] **Step 6: Commit**

```bash
git add app/db/schema.ts app/routes/welcome.tsx vitest.migration.config.ts drizzle/0006_multi_club_expand.sql scripts test/d1/migration.worker.test.ts
git commit -m "feat: add multi-club schema and WOTF backfill"
```

### Task 3: Establish canonical club context and permission checks

**Files:**
- Create: `app/lib/club-path.ts`
- Create: `app/lib/club-permissions.ts`
- Create: `app/lib/clubs.server.ts`
- Modify: `app/lib/auth.server.ts`
- Create: `app/lib/__tests__/club-path.test.ts`
- Create: `app/lib/__tests__/club-permissions.test.ts`
- Create: `test/d1/club-context.worker.test.ts`

**Interfaces:**
- Produces: `clubPath(slug: string, path?: string): string`, `requireClubContext(env: Env, request: Request, slug: string): Promise<ClubContext>`, `requireClubPermission(context, permission): void`, and `requireSuperAdmin(env, request): Promise<User>`.
- `ClubContext` is exactly `{ club: Club; membership: ClubMembership | null; effectiveRole: ClubRole; isSuperAdmin: boolean }`.

- [ ] **Step 1: Write failing context tests**

Cover member resolution, non-member 404, alias redirect preserving suffix and query string, super-admin effective admin, explicit super-admin membership precedence, and archived-club 404. Assert a non-member response body does not contain the club name.

- [ ] **Step 2: Implement shared path and permission functions**

```ts
export function clubPath(slug: string, path = "") {
  const suffix = path === "" || path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  return `/clubs/${encodeURIComponent(slug)}${suffix}`;
}

export type ClubPermission =
  | "use_club"
  | "moderate"
  | "manage_member"
  | "manage_admin"
  | "manage_invites"
  | "manage_identity"
  | "transfer_ownership"
  | "archive";
```

Map members to `use_club`; admins to member management, invitations, and moderation; owners to every club permission. Super-admin effective admins use the admin mapping only.

- [ ] **Step 3: Implement `requireClubContext`**

Authenticate with `requireUser`, resolve `clubs.slug` first and `club_slug_aliases.slug` second, redirect aliases by replacing only `/clubs/<oldSlug>` in `request.url`, and preserve the rest of the path plus query string. Reject archived clubs and unauthorized users with the same 404 response. Set `effectiveRole` from explicit membership, otherwise `admin` only for a `super_admin`.

- [ ] **Step 4: Add global authorization**

Replace `requireAdmin` with:

```ts
export async function requireSuperAdmin(env: Env, request: Request) {
  const user = await requireUser(env, request);
  if (user.platformRole !== "super_admin") {
    throw new Response("Not found", { status: 404 });
  }
  return user;
}
```

Keep a temporary deprecated `requireAdmin` wrapper only until every old admin route is converted in Task 9, then remove it in that task.

- [ ] **Step 5: Run and commit**

Run: `npm run test:all -- club`

Expected: pure permission tests and D1 context tests pass.

```bash
git add app/lib/club-path.ts app/lib/club-permissions.ts app/lib/clubs.server.ts app/lib/auth.server.ts app/lib/__tests__ test/d1/club-context.worker.test.ts
git commit -m "feat: resolve club context and permissions"
```

### Task 4: Implement club creation, membership lifecycle, and audit events

**Files:**
- Modify: `app/lib/clubs.server.ts`
- Create: `app/lib/memberships.server.ts`
- Create: `test/d1/memberships.worker.test.ts`

**Interfaces:**
- Produces: `createClub(env, user, input): Promise<Club>`, `listUserClubs(env, userId)`, `leaveClub(env, context)`, `removeMember(env, context, userId)`, `changeMemberRole(env, context, userId, role)`, `transferOwnership(env, context, newOwnerId)`, `archiveClub(env, context)`, and `restoreClub(env, superAdmin, clubId)`.
- Every sensitive mutation writes `recordAuditEvent` in the same D1 batch as its local state change.

- [ ] **Step 1: Write lifecycle tests**

Test malformed, reserved, canonical, and aliased slug rejection; default `free_only`; creator ownership; one user owning multiple clubs; final-owner leave/remove/demote rejection; admin limits; transactional ownership transfer; owner archive; and super-admin-only restoration.

- [ ] **Step 2: Add slug normalization and creation**

```ts
export const RESERVED_CLUB_SLUGS = new Set([
  "admin", "api", "auth", "clubs", "dev", "join", "login", "logout", "settings",
]);

export function normalizeClubSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isValidClubSlug(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(value)
    && !RESERVED_CLUB_SLUGS.has(value);
}
```

Create the club, owner membership, pending credential row, `last_club_id`, and `club.created` audit event in one `env.DB.batch()`. Return only after the batch commits.

- [ ] **Step 3: Implement owner-safe membership mutations**

Use conditional SQL inside a D1 batch, not a read followed by an unconditional write. Ownership transfer binds `[newOwnerId, currentOwnerId, now, clubId, newOwnerId, currentOwnerId, currentOwnerId, newOwnerId]` to this statement, then inserts the audit event only when `changes() = 2`:

```sql
UPDATE club_memberships
SET role = CASE
  WHEN user_id = ? THEN 'owner'
  WHEN user_id = ? THEN 'admin'
  ELSE role
END,
updated_at = ?
WHERE club_id = ?
  AND user_id IN (?, ?)
  AND EXISTS (
    SELECT 1 FROM club_memberships current_owner
    WHERE current_owner.club_id = club_memberships.club_id
      AND current_owner.user_id = ?
      AND current_owner.role = 'owner'
  )
  AND EXISTS (
    SELECT 1 FROM club_memberships target
    WHERE target.club_id = club_memberships.club_id
      AND target.user_id = ?
      AND target.role != 'owner'
  );
```

Return 409 when the conditional update changes no rows.

- [ ] **Step 4: Run and commit**

Run: `npm run test:d1 -- memberships.worker.test.ts`

Expected: concurrent or stale owner actions never leave zero or two owners.

```bash
git add app/lib/clubs.server.ts app/lib/memberships.server.ts test/d1/memberships.worker.test.ts
git commit -m "feat: add club and membership lifecycle"
```

### Task 5: Scope email invitations and add reusable invite links

**Files:**
- Modify: `app/lib/invites.server.ts`
- Modify: `app/lib/otp.server.ts`
- Modify: `app/lib/google.server.ts`
- Modify: `app/routes/auth.google.tsx`
- Modify: `app/routes/auth.google.callback.tsx`
- Modify: `app/routes/join.tsx`
- Modify: `app/routes.ts`
- Modify: `app/lib/__tests__/invites.test.ts`
- Create: `test/d1/invite-links.worker.test.ts`
- Create: `app/routes/__tests__/join.test.tsx`

**Interfaces:**
- Produces: `createEmailInvitation(env, context, email)`, `createInviteLink(env, context, input): Promise<{ urlToken: string; link: ClubInviteLink }>`, `getInvitePreview(env, token)`, `joinWithInviteLink(env, user, token)`, and `acceptPendingEmailInvitations(env, user)`.

- [ ] **Step 1: Write invitation tests**

Cover immediate membership for an existing account; deferred membership after verified sign-in; link GET without membership creation; 1h, 24h, 7d, and 30d expiry parsing; malformed, expired, revoked, and exhausted neutral errors; duplicate join idempotence; and two users racing for the final slot with exactly one success.

- [ ] **Step 2: Generate and hash link tokens**

```ts
export function generateInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

Store only the hash. Return the raw token once to the route so it can display `/join/<token>`.

- [ ] **Step 3: Implement atomic final-slot consumption**

For a non-member, execute one D1 batch that conditionally increments `current_joins`, inserts the membership only when `changes() = 1`, and writes `membership.joined_via_link`. Use a normal insert so a duplicate race rolls back the increment; catch the unique violation, re-read membership, and return the idempotent success.

- [ ] **Step 4: Update account admission**

`requestLoginCode` and Google callback allow an existing global user, the bootstrap admin, or an email with a non-revoked club invitation. After email verification, call `acceptPendingEmailInvitations`; an invitation for an existing account calls it immediately from the club-admin action. Extend the signed Google OAuth state cookie to carry a same-origin `next` path and return it from `handleGoogleCallback`, so an anonymous `/join/:token` visitor returns to that exact invitation after Google sign-in.

- [ ] **Step 5: Build `/join/:token`**

Change the route to `route("join/:token", "routes/join.tsx")`. The loader returns only club display name and availability. The action requires the user and performs the explicit join. Anonymous users go to `/login?next=/join/<token>`. All unavailable token states render: `This invitation is no longer available. Ask a club administrator for a new one.`

- [ ] **Step 6: Run and commit**

Run: `npm run test:all -- invite`

```bash
git add app/lib/invites.server.ts app/lib/otp.server.ts app/lib/google.server.ts app/routes/auth.google.tsx app/routes/auth.google.callback.tsx app/routes/join.tsx app/routes.ts app/lib/__tests__/invites.test.ts app/routes/__tests__/join.test.tsx test/d1/invite-links.worker.test.ts
git commit -m "feat: add club invitations and invite links"
```

### Task 6: Make every existing data service tenant-explicit

**Files:**
- Modify: `app/lib/projects.server.ts`
- Modify: `app/lib/threads.server.ts`
- Modify: `app/lib/comments.server.ts`
- Modify: `app/lib/feedback.server.ts`
- Modify: `app/routes/welcome.tsx`
- Create: `test/d1/tenant-boundary.worker.test.ts`

**Interfaces:**
- Consumes: `ClubContext` at route/service boundaries and `{ clubId: string; userId: string }` at lower-level participant helpers.
- Produces: no club-owned helper that accepts only `userId`; admin collection helpers accept `clubId` explicitly.

- [ ] **Step 1: Write a cross-club matrix test**

Create two clubs with the same user as a member and one object of every current club-owned type in each. Assert foreign IDs return `null` or no mutation for projects, threads, messages through threads, questionnaire responses, comments, feedback, and admin transcript lookup.

- [ ] **Step 2: Change participant service signatures**

Use this scope consistently:

```ts
export type ClubUserScope = { clubId: string; userId: string };

export async function getProject(env: Env, scope: ClubUserScope, id: string) {
  return getDb(env).query.projects.findFirst({
    where: and(
      eq(projects.id, id),
      eq(projects.clubId, scope.clubId),
      eq(projects.userId, scope.userId),
    ),
  });
}
```

Apply the same `clubId + userId + objectId` rule to create, update, delete, touch, tag, and resume functions. Messages remain scoped through a thread lookup that includes `chat_threads.club_id`.

- [ ] **Step 3: Change club-admin service signatures**

`listAdminThreads`, `getAdminThread`, `listFeedback`, `setFeedbackStatus`, and comment moderation must filter by `clubId`. Comment deletion accepts `{ user, club: ClubContext }`; an effective admin can moderate only inside that club.

- [ ] **Step 4: Move onboarding state and answers to membership scope**

`welcome.tsx` loads `ClubContext`, checks `membership.onboardingStage`, upserts answers on `(club_id, user_id)`, updates only that membership, and redirects to `clubPath(club.slug)`. A super admin without membership does not receive participant onboarding.

- [ ] **Step 5: Run and commit**

Run: `npm run test:d1 -- tenant-boundary.worker.test.ts`

Expected: every cross-club read is empty and every cross-club mutation changes zero rows.

```bash
git add app/lib/projects.server.ts app/lib/threads.server.ts app/lib/comments.server.ts app/lib/feedback.server.ts app/routes/welcome.tsx test/d1/tenant-boundary.worker.test.ts
git commit -m "refactor: scope club data services by tenant"
```

### Task 7: Move all club experiences under the canonical slug

**Files:**
- Modify: `app/routes.ts`
- Modify: `app/routes/app-layout.tsx`
- Modify: `app/routes/settings.tsx`
- Modify: `app/routes/home.tsx`
- Create by moving the current visual home module: `app/routes/club-home.tsx`
- Modify: every current club page and resource route in `app/routes/`
- Create: `app/routes/legacy.$section.tsx`
- Create: `app/routes/legacy.$section.$.tsx`
- Create: `app/routes/__tests__/club-routing.test.ts`

**Interfaces:**
- Consumes: `requireClubContext`, `clubPath`, and tenant-explicit helpers.
- Produces: canonical club routes and legacy redirects to WOTF with path, search, and hash preserved.

- [ ] **Step 1: Write routing and authorization tests**

Assert all existing page and API routes carry `clubSlug`; `/` chooses the last accessible or only club; stale `last_club_id` falls back; alias redirects preserve suffix and query; legacy paths redirect to WOTF; UI unauthorized access is 404; APIs return structured 401, 403, or 404. Task 8 adds the final club-list and `/settings` outcomes before zero-membership and leave actions become available.

- [ ] **Step 2: Replace the route tree**

Build this structure in `app/routes.ts`:

```ts
export default [
  index("routes/home.tsx"),
  route("join/:token", "routes/join.tsx"),
  route("clubs/:clubSlug/welcome", "routes/welcome.tsx"),
  route("clubs/:clubSlug/api/chat", "routes/api.chat.ts"),
  route("clubs/:clubSlug/api/thread", "routes/api.thread.ts"),
  route("clubs/:clubSlug/api/feedback", "routes/api.feedback.ts"),
  route("clubs/:clubSlug", "routes/app-layout.tsx", [
    index("routes/club-home.tsx"),
    route("garden", "routes/garden.tsx"),
    route("garden/conversations/:id", "routes/garden.conversations.$id.tsx"),
    route("garden/projects/:id", "routes/garden.projects.$id.tsx"),
    route("garden/modules/:slug", "routes/garden.modules.$slug.tsx"),
    route("learning", "routes/learning.tsx"),
    route("learning/:slug", "routes/learning.$slug.tsx"),
    route("artifacts", "routes/artifacts.tsx"),
    route("gallery", "routes/gallery.tsx"),
    route("inspiration", "routes/inspiration.tsx"),
    route("admin", "routes/admin.tsx"),
    route("admin/conversations/:id", "routes/admin.conversations.$id.tsx"),
  ]),
  route(":section", "routes/legacy.$section.tsx"),
  route(":section/*", "routes/legacy.$section.$.tsx"),
  route("login", "routes/login.tsx"),
  route("dev/login", "routes/dev.login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("auth/google", "routes/auth.google.tsx"),
  route("auth/google/callback", "routes/auth.google.callback.tsx"),
] satisfies RouteConfig;
```

Rename the current visual home module to `app/routes/club-home.tsx`; the new `home.tsx` is the global redirect loader.

- [ ] **Step 3: Convert route loaders and actions**

Every club route calls `requireClubContext(env, request, params.clubSlug)` before any club-owned query. Build redirects and links with `clubPath(context.club.slug, ...)`. Resource routes return JSON errors; page routes throw 404 for access failures.

- [ ] **Step 4: Add WOTF compatibility redirects**

Allow only `garden`, `learning`, `artifacts`, `gallery`, `inspiration`, and `admin`; return 404 for any other `section`. Redirect to `/clubs/wotf/<original path>` and preserve `search` and `hash`.

- [ ] **Step 5: Run and commit**

Run:

```bash
npm run typecheck
npm test -- club-routing
npm run build
```

```bash
git add app/routes.ts app/routes app/lib/club-path.ts
git commit -m "feat: add canonical club routes"
```

### Task 8: Add global settings, club creation, and accessible switchers

**Files:**
- Create: `app/routes/settings.tsx`
- Modify: `app/routes.ts`
- Create: `app/components/shell/global-page-shell.tsx`
- Create: `app/components/shell/club-switcher.tsx`
- Modify: `app/routes/app-layout.tsx`
- Modify: `app/components/shell/app-shell.tsx`
- Modify: `app/components/shell/left-nav.tsx`
- Modify: `app/components/shell/mobile-nav.tsx`
- Modify: `app/lib/nav.ts`
- Modify: `app/hooks/use-app-user.ts`
- Create: `app/hooks/use-club.ts`
- Create: `app/components/shell/__tests__/club-switcher.test.tsx`
- Create: `app/routes/__tests__/settings.test.tsx`

**Interfaces:**
- Produces: `useClub(): ClubContextView`, club-aware nav items, display-name editing, club creation, club list, and member/admin leave actions.

- [ ] **Step 1: Write settings and switcher tests**

Test proposed editable slug, slug errors, creation redirect, persisted global theme, roles displayed as text, owner transfer guidance instead of leave, archived-club status without an open link, accessible desktop and mobile dropdowns, current-club marking, and switch navigation to the selected club home rather than a nested equivalent.

- [ ] **Step 2: Build global settings**

Add `route("settings", "routes/settings.tsx")` immediately after the root index. The loader returns global user details and all explicit club memberships, including archived clubs. Actions use explicit intents: `profile`, `theme`, `create-club`, and `leave-club`. Persist `theme_pref` as `system`, `light`, or `dark` and initialize `next-themes` from it. Successful creation commits the pending credential row and redirects to `clubPath(club.slug)`; Task 11 attaches background provisioning after the OpenRouter boundary exists. A failed batch returns the inline message `The club could not be created. Your other clubs were not changed.`

- [ ] **Step 3: Expose club-shell data**

`app-layout.tsx` returns current club, explicit and effective roles, all accessible active clubs, allowed models, and club-scoped Gardener history. Entering a canonical club updates `last_club_id` after access succeeds. Incomplete explicit membership redirects to `/clubs/:slug/welcome`.

- [ ] **Step 4: Build one switcher for desktop and mobile**

`ClubSwitcher` takes:

```ts
type ClubSwitcherProps = {
  current: { name: string; slug: string };
  clubs: { name: string; slug: string; role: ClubRole }[];
  compact?: boolean;
  onNavigate?: () => void;
};
```

Render it immediately below Vibe Garden in both navigation surfaces. Include current-state text, `Create club` linking to `/settings?create=1`, and `Manage clubs` linking to `/settings`. Preserve keyboard navigation through the existing Radix dropdown.

- [ ] **Step 5: Make all navigation paths club-relative**

Change `navItems` to relative suffixes and map them through `clubPath`. Update `ContentLink`, chat-rendered article/module links, feedback action, and both shell components. Global `/logout` and `/settings` remain absolute.

- [ ] **Step 6: Run and commit**

Run: `npm run typecheck && npm test -- settings club-switcher && npm run build`

```bash
git add app/routes.ts app/routes/settings.tsx app/routes/app-layout.tsx app/components/shell app/lib/nav.ts app/hooks app/components/gardener/chat-message.tsx app/components/content-link.tsx app/components/feedback/feedback-dialog.tsx app/routes/__tests__
git commit -m "feat: add club settings and switcher"
```

### Task 9: Split club administration by permission boundary

**Files:**
- Modify: `app/routes/admin.tsx`
- Create: `app/routes/admin.members.tsx`
- Create: `app/routes/admin.invitations.tsx`
- Create: `app/routes/admin.settings.tsx`
- Modify: `app/routes.ts`
- Modify: `app/routes/admin.conversations.$id.tsx`
- Modify: `app/lib/auth.server.ts`
- Create: `app/routes/__tests__/club-admin.test.tsx`
- Create: `test/d1/club-admin.worker.test.ts`

**Interfaces:**
- Consumes: membership and invitation mutations from Tasks 4 and 5.
- Produces: Overview, Members, Invitations, and Settings sections with server-enforced owner/admin differences.

- [ ] **Step 1: Write the permission matrix tests**

Test that admins can invite, revoke links, remove members, moderate, and review club feedback/conversations; owners can also manage admin roles, transfer ownership, edit name/slug, and archive; admins cannot act on owners or admins; super admins without membership get only effective-admin operations.

- [ ] **Step 2: Convert the existing admin page to Overview**

Filter all activity summaries, responses, feedback, and conversations by current `club.id`. Add links to the three focused sections and show AI availability without key material.

- [ ] **Step 3: Build Members and Invitations**

Add the `admin/members`, `admin/invitations`, and `admin/settings` route declarations below the club `admin` route. Use intent-dispatched forms whose actions call `requireClubPermission`. Include textual role labels, owner transfer confirmation, pending email invitation state, reusable-link expiry/use counts, raw URL display only immediately after creation, and revocation.

- [ ] **Step 4: Build owner Settings**

Name change updates `clubs.name`. Slug change validates canonical and alias namespaces, inserts the old slug alias, updates the club slug, and writes one audit event in the same batch. Archive requires typed club name confirmation and calls `archiveClub`.

- [ ] **Step 5: Remove legacy platform-admin assumptions**

Delete `requireAdmin`; replace all remaining `user.role` checks with either club permissions or `platformRole`. Search must return no matches outside migration compatibility code:

```bash
rg -n 'requireAdmin|user\.role|users\.role|user\.stage|user\.modelPref' app
```

- [ ] **Step 6: Run and commit**

Run: `npm run test:all -- admin`

```bash
git add app/routes.ts app/routes/admin* app/lib/auth.server.ts app/routes/__tests__/club-admin.test.tsx test/d1/club-admin.worker.test.ts
git commit -m "feat: add scoped club administration"
```

### Task 10: Add model-policy and encrypted OpenRouter primitives

**Files:**
- Modify: `app/lib/models.ts`
- Create: `app/lib/credential-crypto.server.ts`
- Create: `app/lib/openrouter-management.server.ts`
- Modify: `app/types/env.d.ts`
- Modify: `wrangler.jsonc`
- Create: `app/lib/__tests__/models-policy.test.ts`
- Create: `app/lib/__tests__/credential-crypto.test.ts`
- Create: `app/lib/__tests__/openrouter-management.test.ts`

**Interfaces:**
- Produces: `modelsForPolicy(policy)`, `resolveClubModel(policy, requested, saved)`, `encryptCredential(plaintext, key, version)`, `decryptCredential(record, env)`, and `OpenRouterManagementClient`.

- [ ] **Step 1: Write policy and crypto tests**

Assert every `free_only` model ends in `:free`, all-model clubs receive the curated list, stale preferences fall back to the policy default, AES-GCM round-trips, wrong key/version fails, IVs differ for the same plaintext, and no returned object exposes the encryption key.

- [ ] **Step 2: Centralize model policy**

```ts
export const freeModels = models.filter((model) => model.id.endsWith(":free"));
export const defaultFreeModel = freeModels[0];

export function modelsForPolicy(policy: ModelPolicy) {
  return policy === "free_only" ? freeModels : models;
}

export function resolveClubModel(policy: ModelPolicy, requested?: string, saved?: string | null) {
  const allowed = modelsForPolicy(policy);
  return allowed.find((model) => model.id === requested)
    ?? allowed.find((model) => model.id === saved)
    ?? allowed[0];
}
```

Fail startup or tests when `freeModels` is empty.

- [ ] **Step 3: Implement versioned AES-GCM**

Read a base64-encoded 32-byte `OPENROUTER_CREDENTIAL_KEY_V1`, generate a fresh 12-byte IV, and store ciphertext and IV as base64. Bind `clubId` and key version as AES-GCM additional authenticated data so ciphertext cannot be moved between clubs.

- [ ] **Step 4: Implement the typed Management API client**

Use `OPENROUTER_MANAGEMENT_KEY` only in this module. Implement `listKeys(includeDisabled)`, `createKey`, `updateKey`, `listGuardrails`, `createGuardrail`, `updateGuardrail`, `assignKeyToGuardrail`, `listKeyAssignments`, and `deleteKey`. Validate `response.ok`, parse only documented fields, and return sanitized errors without response bodies.

The current API contracts are `POST /api/v1/keys` with one-time `key`, `PATCH /api/v1/keys/:hash`, and `POST /api/v1/guardrails/:id/assignments/keys` with `{ key_hashes: [keyHash] }`.

- [ ] **Step 5: Declare secrets and regenerate types**

Add optional local type declarations for `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_CREDENTIAL_KEY_V1`, `OPENROUTER_WORKSPACE_ID`, and `ALLOW_WOTF_LEGACY_KEY`. Document them in `wrangler.jsonc` comments, not vars. Run `npm run cf-typegen` if generated Worker types change.

- [ ] **Step 6: Run and commit**

Run: `npm test -- models-policy credential-crypto openrouter-management && npm run typecheck`

```bash
git add app/lib/models.ts app/lib/credential-crypto.server.ts app/lib/openrouter-management.server.ts app/lib/__tests__ app/types/env.d.ts wrangler.jsonc
git commit -m "feat: add encrypted OpenRouter management primitives"
```

### Task 11: Provision club credentials and enforce policy in chat

**Files:**
- Create: `app/lib/club-ai.server.ts`
- Modify: `app/routes/api.chat.ts`
- Modify: `app/routes/api.thread.ts`
- Modify: `app/components/gardener/gardener-provider.tsx`
- Modify: `app/components/gardener/model-picker.tsx`
- Modify: `app/routes/app-layout.tsx`
- Create: `test/d1/club-ai.worker.test.ts`
- Modify: `app/components/gardener/__tests__/gardener-provider.test.tsx`

**Interfaces:**
- Produces: `provisionClubAi(env, clubId, client?)`, `syncClubPolicy(env, clubId, client?)`, `getClubChatCredential(env, clubId)`, `rotateClubCredential(env, clubId, client?)`, and `setClubCredentialDisabled(env, clubId, disabled, client?)`.

- [ ] **Step 1: Write lifecycle tests with a fake management client**

Cover first provision, remote retry without duplicate usable keys, lost one-time plaintext recovery by disabling the unusable remote key and creating a replacement, free guardrail reuse, WOTF guardrail creation, confirmed assignment before ready, sanitized failure, policy downgrade drift, rotation replacement-before-disable, archival disable, and encrypted-at-rest storage.

- [ ] **Step 2: Implement idempotent provisioning**

Use stable names `vibegarden:club:<clubId>` and `vibegarden:free-only:v1`. Reconcile local hash against `listKeys(true)`. Create a key only when there is no usable encrypted local key, encrypt its one-time plaintext immediately, create or find the guardrail, assign by `key_hash`, verify the assignment, then set `ready` and `synced_policy`.

For `free_only`, create the key with the default $5 monthly limit and assign the shared explicit free-model allowlist. OpenRouter blocks requests when a key has a zero-dollar limit, so the allowlist is the authoritative paid-model restriction. For `all_models`, use the club spending limit when configured, otherwise the same $5 monthly default, plus a per-club guardrail with the full curated allowlist.

- [ ] **Step 3: Fail closed on drift and rotate safely**

Set `provisioning_state = 'pending'` before policy synchronization. Do not return a chat credential until state is `ready` and `synced_policy = clubs.model_policy`. Rotation stores encrypted candidate fields, verifies assignment, promotes candidate columns, and only then disables the old hash; a retry resumes from candidate state.

- [ ] **Step 4: Enforce the same policy in loader and chat**

`app-layout.tsx` returns only `modelsForPolicy(club.modelPolicy)`. `ModelPicker` renders that list. `api.chat.ts` resolves the requested model with `resolveClubModel`, rejects a model outside the policy before decryption, obtains the club credential, and writes membership `model_pref`. It never reads another club key.

Allow the old `OPENROUTER_API_KEY` only when `club.id === 'club_wotf'`, `ALLOW_WOTF_LEGACY_KEY === 'true'`, and the dedicated WOTF credential is not ready. No other club can take this branch.

- [ ] **Step 5: Make client APIs canonical**

Pass `apiBase={clubPath(slug, "api")}` into `GardenerProvider`; replace its `/api/chat` and `/api/thread` fetches. Reset provider messages, model, datasets, and in-flight state when the club slug changes. After a settings action successfully creates a club, call `ctx.waitUntil(provisionClubAi(env, club.id))`; the redirect does not wait for OpenRouter.

- [ ] **Step 6: Run and commit**

Run: `npm run test:all -- club-ai gardener-provider && npm run build`

```bash
git add app/lib/club-ai.server.ts app/routes/api.chat.ts app/routes/api.thread.ts app/routes/settings.tsx app/components/gardener app/routes/app-layout.tsx test/d1/club-ai.worker.test.ts
git commit -m "feat: provision and enforce club AI credentials"
```

### Task 12: Add the super-admin clubs dashboard and platform controls

**Files:**
- Create: `app/routes/admin.clubs.tsx`
- Modify: `app/routes.ts`
- Create: `app/routes/__tests__/admin-clubs.test.tsx`
- Create: `test/d1/platform-admin.worker.test.ts`
- Modify: `app/lib/clubs.server.ts`
- Modify: `app/lib/memberships.server.ts`

**Interfaces:**
- Produces: `listPlatformClubs(env)`, `setClubModelPolicy`, `setClubSpendingLimit`, and UI actions `policy`, `spending`, `retry`, `rotate`, `disable`, and `restore`.

- [ ] **Step 1: Write platform authorization and summary tests**

Assert normal users receive 404; counts exclude implicit super admins; each row shows owner, explicit member count, status, model policy, credential state, sync drift, and spending cap; and every action records a non-secret audit event.

- [ ] **Step 2: Build the dashboard loader and table**

Add `route("admin/clubs", "routes/admin.clubs.tsx")` beside the global settings route. Call `requireSuperAdmin` first. Use grouped D1 queries by club rather than per-row queries. Provide an `Open club` link only for active clubs; the target route revalidates effective admin access.

- [ ] **Step 3: Implement platform actions**

Policy and spending mutations update desired local state, set credential state pending, audit, then run `syncClubPolicy` through `ctx.waitUntil`. Retry and rotate use the same background pattern. Disable synchronously marks local credential state before remote work so chat fails closed. Restoration is super-admin-only and triggers enable plus policy synchronization; archival remains in the owner-only club settings action from Task 9.

- [ ] **Step 4: Run and commit**

Run: `npm run test:all -- admin-clubs platform-admin`

```bash
git add app/routes.ts app/routes/admin.clubs.tsx app/routes/__tests__/admin-clubs.test.tsx app/lib/clubs.server.ts app/lib/memberships.server.ts test/d1/platform-admin.worker.test.ts
git commit -m "feat: add platform club administration"
```

### Task 13: Add sanitized logging and scheduled reconciliation

**Files:**
- Create: `app/lib/operational-log.server.ts`
- Modify: `app/lib/club-ai.server.ts`
- Modify: `workers/app.ts`
- Modify: `wrangler.jsonc`
- Create: `app/lib/__tests__/operational-log.test.ts`
- Create: `test/d1/reconciliation.worker.test.ts`

**Interfaces:**
- Produces: `logOperation(input)`, `reconcileClubAi(env, client?)`, and a Worker `scheduled` handler.

- [ ] **Step 1: Write redaction and reconciliation tests**

Pass objects containing `key`, `token`, `content`, `answers`, ciphertext, and safe identifiers to the logger; assert serialized output contains club ID, request ID, operation, and state but none of the sensitive values. Reconciliation tests cover missing assignments, safe metadata drift, orphan key, duplicate key, resolved finding, and provider failure.

- [ ] **Step 2: Implement a strict structured logger**

Accept an allowlisted shape only:

```ts
type OperationalLog = {
  level: "info" | "warn" | "error";
  operation: string;
  requestId?: string;
  clubId?: string;
  provisioningState?: ProvisioningState;
  code?: string;
};
```

Do not accept arbitrary metadata. Audit-event metadata also uses action-specific allowlists.

- [ ] **Step 3: Reconcile remote and local state**

List managed keys, guardrails, and assignments. Repair a missing assignment or safe name/limit drift. Never guess which duplicate key to use; persist an open `ai_reconciliation_findings` row for orphaned or duplicate credentials. Mark findings resolved when the next run confirms the issue is gone.

- [ ] **Step 4: Add an hourly scheduled handler**

Extend `workers/app.ts`:

```ts
async scheduled(_controller, env, ctx) {
  ctx.waitUntil(reconcileClubAi(env));
}
```

Add `"triggers": { "crons": ["17 * * * *"] }` to `wrangler.jsonc`. This runs hourly at minute 17 UTC and avoids the common top-of-hour burst.

- [ ] **Step 5: Run and commit**

Run:

```bash
npm run test:all -- operational-log reconciliation
npm run dev
curl "http://localhost:5173/cdn-cgi/handler/scheduled?format=json"
```

Expected: tests pass and the local scheduled handler reports an `ok` outcome without secrets in logs.

```bash
git add app/lib/operational-log.server.ts app/lib/club-ai.server.ts app/lib/__tests__/operational-log.test.ts workers/app.ts wrangler.jsonc test/d1/reconciliation.worker.test.ts
git commit -m "feat: reconcile club AI credentials"
```

### Task 14: Prepare rollout artifacts and pass the local release gate

**Files:**
- Modify: `scripts/first-deploy.sh`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Create: `docs/runbooks/multi-club-rollout.md`

**Interfaces:**
- Consumes: all implementation tasks and local Cloudflare bindings.
- Produces: locally verified code, reviewed migration and rollback commands, documented secret requirements, and a hard approval boundary before any external mutation.

- [ ] **Step 1: Run the full local gate**

Run:

```bash
npm run test:all
npm run typecheck
npm run build
npm run db:migrate
npx wrangler d1 execute DB --local --file scripts/backfill-wotf.sql
npx wrangler d1 execute DB --local --file scripts/verify-multi-club-migration.sql
```

Expected: all tests pass; build succeeds; migration-history tests prove baseline, expand, idempotent backfill, and contract behavior; local verification emits no violation rows.

- [ ] **Step 2: Write the rollout runbook without executing live commands**

Document the exact commands from the approval-gated checklist below, the expected output after each command, the D1 restore bookmark procedure, the WOTF legacy-key fallback, OpenRouter cleanup, and stop conditions. State at the top of the runbook:

```text
This runbook mutates Cloudflare D1, Worker secrets and deployments, and OpenRouter resources. Do not execute any live step without explicit user authorization naming the target environment.
```

- [ ] **Step 3: Document configuration and pending rollout status**

Document `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_CREDENTIAL_KEY_V1`, `OPENROUTER_WORKSPACE_ID`, the reconciliation cron, and the rule that plaintext keys and raw invite tokens are never recoverable from D1. Update `docs/ROADMAP.md` to say `implementation ready, production rollout pending`; do not mark the feature complete.

- [ ] **Step 4: Verify the implementation stopped at the approval boundary**

Do not run commands containing `--remote`, `wrangler deploy`, `wrangler secret put`, or live OpenRouter Management API calls during implementation. Review the working tree and local results:

```bash
git diff --check
git status --short
```

Expected: only implementation, tests, migration scripts, and documentation changed; no claim is made that production or OpenRouter was updated.

- [ ] **Step 5: Commit local rollout readiness**

```bash
git add scripts/first-deploy.sh README.md docs/ROADMAP.md docs/runbooks/multi-club-rollout.md
git commit -m "docs: prepare multi-club rollout"
```

## Live Rollout Approval Gate

These steps are not authorized by implementation of Tasks 1 through 14. Stop and request explicit user authorization before executing them. The authorization must identify the Cloudflare environment or D1 database and the OpenRouter workspace; authorization for production does not implicitly authorize a separate staging workspace, or vice versa.

### Gate 1: Back up production and record recovery state

After explicit production authorization, run:

```bash
mkdir -p .context/backups
npx wrangler d1 export vibe-garden --remote --output=.context/backups/vibe-garden-pre-multi-club.sql
npx wrangler d1 time-travel info vibe-garden
```

Record the current application deployment ID and D1 bookmark in `.context`, which is gitignored. Do not put the export, bookmark, or secrets in the repository.

### Gate 2: Apply expand and backfill

```bash
npx wrangler d1 migrations apply vibe-garden --remote
npx wrangler d1 execute vibe-garden --remote --file scripts/backfill-wotf.sql
npx wrangler d1 execute vibe-garden --remote --file scripts/verify-multi-club-migration.sql
```

Expected: WOTF owns every legacy row, all users have membership, and the configured admin is the sole WOTF owner and a super admin. Stop before deployment if any invariant query returns a violation.

### Gate 3: Configure secrets and deploy club-aware routes

Set `OPENROUTER_MANAGEMENT_KEY` and `OPENROUTER_CREDENTIAL_KEY_V1` with `wrangler secret put`. Temporarily set `ALLOW_WOTF_LEGACY_KEY=true`, deploy, and verify legacy redirects, WOTF onboarding state, admin views, and cross-club 404 behavior.

### Gate 4: Run the real OpenRouter smoke test

After separate authorization for the named non-production OpenRouter workspace, create a temporary club and verify dedicated key creation with a $5 monthly limit, shared free-only guardrail assignment, one allowlisted free request, rejection of a paid model, and cleanup or disable.

### Gate 5: Provision WOTF and remove fallback

Trigger WOTF retry from `/admin/clubs`; confirm ready state, guardrail assignment, and one Gardener request. Set `ALLOW_WOTF_LEGACY_KEY=false`, deploy, then remove the old `OPENROUTER_API_KEY` secret after log and dashboard verification.

### Gate 6: Contract only after stable production verification

Move the reviewed contract script into the migration directory and update `app/db/schema.ts` in the same commit to remove legacy user fields and make every club-owned `clubId` non-null:

```bash
git mv scripts/contract-multi-club.sql drizzle/0007_multi_club_contract.sql
npm run test:all
npm run typecheck
npx wrangler d1 migrations apply vibe-garden --remote
npx wrangler d1 execute vibe-garden --remote --file scripts/verify-multi-club-migration.sql
```

Expected: tenant columns are required, legacy user columns and `invites` are absent, and verification remains clean. Mark the roadmap complete and commit the contract only after this verification:

```bash
git add drizzle/0007_multi_club_contract.sql app/db/schema.ts docs/ROADMAP.md docs/runbooks/multi-club-rollout.md
git commit -m "feat: contract multi-club schema"
```

## Final Verification Matrix

Run after the contract migration:

```bash
npm run test:all
npm run typecheck
npm run build
rg -n 'requireAdmin|user\.role|users\.role|user\.stage|user\.modelPref|OPENROUTER_API_KEY' app workers
```

Expected search result: no legacy authorization or user-scoped onboarding/model fields, and the old OpenRouter key appears only in the explicitly temporary WOTF fallback block until Task 14 removes it.

Manually verify at desktop and mobile widths:

- A member of two clubs sees independent onboarding, model preference, projects, conversations, comments, feedback, and admin access.
- Switching clubs opens the selected club home, updates `last_club_id`, and does not preserve the nested page.
- Unknown, archived, and unauthorized club routes show the same 404 behavior.
- Cross-club project, conversation, comment, feedback, and invitation IDs return 404.
- Owner, admin, member, explicit super-admin membership, and implicit super-admin permissions match the matrix.
- Link invitations require explicit confirmation and show the neutral unavailable state for every invalid condition.
- AI pending, failed, drifted, disabled, archived, and ready states show a clear next action without leaking provider details.
- The club switcher, dialogs, forms, and mobile sheet work by keyboard, retain focus correctly, and expose textual role and status labels.
