# Artifact Upload and Rendering Implementation Plan

**Goal:** Add project-owned, immutable artifact versions with browser upload, authenticated gallery sharing, safe file and link handling, and sandboxed HTML rendering from a private R2 bucket.

**Architecture:** The existing Vibe Garden Worker owns authentication, artifact metadata, upload orchestration, publication state, and capability issuance. A separate renderer Worker at `usercontent.vibegarden.club` has only a private R2 binding and a dedicated signing secret; it validates short-lived capabilities and serves immutable files with renderer-owned security policy. Website routes and the later OAuth-authenticated MCP write tools call the same artifact service and never implement ownership, versioning, or storage rules themselves.

**Tech Stack:** TypeScript 5.9, React 19, React Router 8 framework mode, Cloudflare Workers, D1 with Drizzle ORM 0.45, private R2, `@zip.js/zip.js` 2.8.31, DuckDB-Wasm 1.33.1-dev57.0, Vitest 4, Cloudflare Workers Vitest pool 0.18.6, Playwright 1.60.

## Global Constraints

- Interactive HTML is the primary artifact type; `html`, safe download-only `file`, and normalized HTTPS `link` are the only accepted types.
- Every artifact belongs to exactly one owned project and starts with `visibility = "private"`; browser creation may atomically create a `seed` project, while MCP creation requires an existing owned project.
- Artifact type and project never change. Metadata edits do not create versions; content or URL changes always create a retained immutable version.
- `current_version_id` and `gallery_version_id` are separate pointers. Upload and restore change only the current pointer; only explicit publication changes the gallery pointer.
- Keep `public` reserved in D1 but reject it in website and MCP input until rendering moves to a separate registrable domain.
- Browser packages allow at most 500 files, 100 MB expanded per version, 25 MB per ordinary asset, and one data or media file up to the remaining 100 MB aggregate allowance.
- MCP text packages allow at most 100 files and 2 MB aggregate UTF-8 content.
- HTML packages require a root `index.html`. Normalize UTF-8 relative paths; reject absolute paths, traversal, empty segments, control characters, normalized duplicates, symlinks, special ZIP entries, `.DS_Store`, and `__MACOSX`.
- This implementation bounds each path segment to 255 UTF-8 bytes and the complete normalized path to 1,024 UTF-8 bytes.
- Download artifacts use an explicit extension/MIME allowlist, `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`; executable, installer, macro-enabled Office, or mismatched content is rejected.
- Production links and data origins are exact HTTPS origins. Static dependency hosts are exactly `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`, `fonts.googleapis.com`, and `fonts.gstatic.com`.
- Pin and host the single-thread DuckDB-Wasm `1.33.1-dev57.0` EH bundle on the renderer origin. Do not enable cross-origin isolation or a multithreaded bundle.
- Preview and full-screen views remain authenticated website wrappers containing `<iframe sandbox="allow-scripts">`. Never add `allow-same-origin`, forms, popups, top-level navigation, or direct opening of an HTML renderer entry document.
- Renderer policy is server-owned and deterministic. Uploaded HTML and R2 metadata cannot override CSP, Permissions Policy, CORS, referrer policy, caching, or framing policy.
- Capability lifetime is five minutes. Claims bind token version, mode, version ID, immutable prefix, entry path, policy version, allowed data origins, and expiry.
- `RENDERER_SIGNING_SECRET` is dedicated and must differ from `SESSION_SECRET`; the renderer deployment receives no session secret, OAuth state, D1 binding, or website routes.
- The artifact R2 bucket remains private and is bound to both Workers. Never configure an R2 public development URL or custom public bucket domain.
- Production website origin is exactly `https://vibegarden.club`; production renderer origin is exactly `https://usercontent.vibegarden.club`. Local origins are explicit environment values, never wildcards.
- Every cookie-authenticated POST, PUT, PATCH, and DELETE request passes a central exact-origin guard before React Router route logic. `Origin: null`, missing origin, the renderer origin, and unrelated origins fail closed.
- Session and OAuth state cookies remain host-only: secure in HTTPS, HTTP-only, and appropriately SameSite-restricted. Never set a `Domain` attribute.
- Soft-deleted artifacts remain recoverable for 30 days. Expired uploads, failed uploads, pending object leases, and expired soft deletes are removed idempotently by scheduled cleanup.
- Stable public errors expose no D1, R2, uploaded source, path, capability, query string, token, email, or stack detail. Missing and unauthorized private records are indistinguishable to non-owners.
- Logs contain only operation, opaque request ID, one-way user hash, artifact/version/upload IDs, counts, bytes, duration, outcome, and stable error code. Renderer invocation logging stays disabled so capability-bearing paths are not captured.
- MCP create/version requires `artifacts:write`; gallery publication requires `artifacts:publish`. Token `userId` is authoritative and caller-provided identity is ignored.
- Keep the current `MAIL_FROM` value until a `vibegarden.club` sender is verified with the mail provider and DNS.
- Follow repository copy style: no em or en dashes.

## Delivery Order and Dependency

Tasks 1 through 14 produce a complete browser feature and renderer without the Gardener MCP server. Task 15 integrates the artifact service into the approved Gardener MCP implementation from `docs/specs/2026-07-18-gardener-mcp-server-design.md`; merge or rebase that work before starting Task 15. If its generic Worker test harness lands first, extend the existing files instead of creating a second harness.

---

## File Map

### Guardrails and infrastructure

- Create `AGENTS.md`: security invariants and required boundary tests.
- Modify `package.json`, `package-lock.json`, `wrangler.jsonc`, and `app/types/env.d.ts`: package, R2, origin, metrics, and cron configuration.
- Create `wrangler.renderer.jsonc`: isolated renderer deployment and private R2 binding.
- Create `vitest.worker.config.ts`, `test/worker/**`, `playwright.config.ts`, `wrangler.security.jsonc`, and `test/security/**`: D1/R2 and browser-boundary harnesses.

### Artifact domain

- Modify `app/db/schema.ts`; generate `drizzle/0006_artifacts.sql` and `drizzle/meta/0006_snapshot.json`: artifact, immutable version, file, upload, object lease, and idempotency state.
- Create `app/lib/artifacts/contracts.ts` and `validation.ts`: types, limits, allowlists, paths, MIME, signatures, origins, and manifests.
- Create `app/lib/artifacts/repository.server.ts` and `object-store.server.ts`: owned D1 access and immutable R2 access.
- Create `app/lib/artifacts/service.server.ts`, `presenters.server.ts`, `http.server.ts`, `observability.server.ts`, and `cleanup.server.ts`: the authoritative domain boundary.

### Website, renderer, and MCP

- Create resource routes under `app/routes/api.artifact-*`; create `app/lib/artifacts/package.client.ts`, `upload.client.ts`, and `app/components/artifacts/**`.
- Modify `app/routes/artifacts.tsx` and `gallery.tsx`; create artifact detail, full-screen, and download routes.
- Create `app/lib/artifacts/capability.ts`, `policy.ts`, `workers/renderer.ts`, `wrangler.renderer.jsonc`, and pinned runtime assets.
- Modify MCP contracts/server/consent from the companion milestone and create `app/lib/mcp/artifact-presenter.server.ts`.

---

## Milestone 1: Security Foundation and Artifact Domain

### Task 1: Repository Guardrails, Dependencies, Bindings, and Worker Test Harness

**Files:**
- Create: `AGENTS.md`
- Modify: `package.json`, `package-lock.json`, `wrangler.jsonc`, `app/types/env.d.ts`
- Create: `vitest.worker.config.ts`, `test/worker/setup.ts`, `test/worker/env.d.ts`, `test/worker/fixture-worker.ts`

**Interfaces:**
- Produces `env.ARTIFACTS: R2Bucket`, `env.ARTIFACT_METRICS: AnalyticsEngineDataset`, `env.APP_ORIGIN`, `env.RENDERER_ORIGIN`, `env.WEB_ALLOWED_ORIGINS`, and `env.RENDERER_SIGNING_SECRET`.
- Produces `npm run test:worker`, while preserving the existing `npm test` jsdom suite.

- [ ] **Step 1: Write the root security instructions**

Create `AGENTS.md` with the renderer, cookie, iframe, CSP, R2, public-sharing, and origin invariants from Global Constraints. End it with:

```markdown
Before changing an artifact security boundary, run:

- `npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts`
- `npm run test:worker`
- `npm run test:security`
- `npm run typecheck`

The negative fixtures in `test/security/fixtures/forbidden.html` are mandatory. A CSP, sandbox, CORS, capability, cookie, or renderer-host change must add or update a negative assertion before it lands.
```

- [ ] **Step 2: Install and pin exact dependencies**

Run:

```bash
npm install @zip.js/zip.js@2.8.31 --save-exact
npm install --save-dev @cloudflare/vitest-pool-workers@0.18.6 @playwright/test@1.60.0 --save-exact
```

Pin `@duckdb/duckdb-wasm` to `1.33.1-dev57.0`. Add scripts `copy:renderer-runtime`, `test:worker`, `test:security`, `test:all`, and `deploy:renderer`; `test:all` runs jsdom, workerd, then Playwright.

- [ ] **Step 3: Add main Worker configuration without changing mail delivery**

Add to `wrangler.jsonc`:

```jsonc
"vars": {
  "ADMIN_EMAIL": "dumky@motherduck.com",
  "MAIL_FROM": "Vibe Garden <no-reply@vibegarden.dumky.net>",
  "APP_ORIGIN": "https://vibegarden.club",
  "RENDERER_ORIGIN": "https://usercontent.vibegarden.club",
  "WEB_ALLOWED_ORIGINS": "https://vibegarden.club"
},
"r2_buckets": [{ "binding": "ARTIFACTS", "bucket_name": "vibe-garden-artifacts" }],
"analytics_engine_datasets": [{ "binding": "ARTIFACT_METRICS", "dataset": "vibe_garden_artifacts" }],
"triggers": { "crons": ["23 3 * * *"] }
```

Add `RENDERER_SIGNING_SECRET` to the secrets comment. Do not add a public R2 URL or replace `MAIL_FROM`.

- [ ] **Step 4: Type bindings and add the workerd runner**

Extend `Env` with the six bindings/variables above. Configure `cloudflareTest` with `readD1Migrations`, `main: "./test/worker/fixture-worker.ts"`, the existing Wrangler config, explicit test origins/secrets, and `TEST_MIGRATIONS`. `setup.ts` calls `applyD1Migrations`; `env.d.ts` augments `ProvidedEnv`; the fixture initially returns `{ ok: true }`.

- [ ] **Step 5: Verify and commit**

```bash
npm run cf-typegen
npm test
npm run test:worker -- --passWithNoTests
npm run typecheck
git add AGENTS.md package.json package-lock.json wrangler.jsonc app/types/env.d.ts vitest.worker.config.ts test/worker
git commit -m "build: add artifact security foundation"
```

### Task 2: D1 Artifact, Upload, Lease, and Idempotency Schema

**Files:**
- Modify: `app/db/schema.ts`
- Create: `drizzle/0006_artifacts.sql`, `drizzle/meta/0006_snapshot.json`, `test/worker/artifact-schema.test.ts`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces `artifacts`, `artifactVersions`, `artifactFiles`, `artifactUploads`, `artifactUploadFiles`, `artifactObjectLeases`, and `artifactIdempotency`.

- [ ] **Step 1: Write failing schema integration assertions**

Query `sqlite_schema` and foreign-key metadata. Assert all seven tables exist, project deletion is restricted, and duplicate version numbers, version/upload paths, R2 keys, upload idempotency keys, and scoped mutation idempotency keys fail.

- [ ] **Step 2: Add the exact design fields and constraints**

Add every column in the design, with `currentVersionId` nullable only to break the insert cycle and `galleryVersionId` nullable by design. Add CHECK constraints for artifact type, visibility, version source, upload source/status, and non-negative sizes/counts. Add unique `(artifact_id, version_number)`, `(version_id, path)`, `(upload_id, path)`, and immutable `r2_key` constraints plus owned-list, gallery, version, expiry, and cleanup indices.

Add this internal write ledger so every pre-transaction R2 write is reclaimable:

```ts
export const artifactObjectLeases = sqliteTable("artifact_object_leases", {
  r2Key: text("r2_key").primaryKey(),
  uploadId: text("upload_id"),
  userId: text("user_id").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

Add `artifactIdempotency` with `userId`, `operation`, `targetKey`, `idempotencyKey`, canonical fingerprint, artifact/version IDs, created time, and a unique index on the first four scope fields.

- [ ] **Step 3: Generate, inspect, and apply migration 0006**

```bash
npm run db:generate -- --name artifacts
npm run db:migrate
npm run test:worker -- test/worker/artifact-schema.test.ts
npm run typecheck
```

Expected: `0006_artifacts.sql` and snapshot/journal updates appear, migration re-run is a no-op, and schema assertions pass.

- [ ] **Step 4: Commit**

```bash
git add app/db/schema.ts drizzle test/worker/artifact-schema.test.ts
git commit -m "feat: add artifact persistence schema"
```

### Task 3: Artifact Contracts, Paths, MIME Rules, Origins, and Manifests

**Files:**
- Create: `app/lib/artifacts/contracts.ts`, `app/lib/artifacts/validation.ts`
- Create: `app/lib/artifacts/__tests__/validation.test.ts`, `app/lib/artifacts/__tests__/manifest.test.ts`

**Interfaces:**
- Produces `ArtifactError`, `ARTIFACT_LIMITS`, artifact/file types, path/URL/origin validators, content inspection, package validation, manifest hash, and mutation fingerprint.

- [ ] **Step 1: Write table-driven failing tests**

Cover Unicode NFC, byte boundaries, traversal, backslashes, control characters, normalized duplicates, hidden metadata, root index, file/byte limits, extension/MIME mapping, UTF-8 failures, PNG/JPEG/PDF/ZIP/GZIP/Parquet/Wasm signatures, HTTPS-only links, and exact-origin normalization/rejection.

- [ ] **Step 2: Define exact constants and typed errors**

```ts
export const ARTIFACT_LIMITS = {
  browserFiles: 500,
  browserBytes: 100 * 1024 * 1024,
  ordinaryFileBytes: 25 * 1024 * 1024,
  mcpFiles: 100,
  mcpBytes: 2 * 1024 * 1024,
  pathBytes: 1024,
  segmentBytes: 255,
  titleChars: 120,
  descriptionChars: 1000,
  origins: 20,
  uploadTtlMs: 24 * 60 * 60 * 1000,
  capabilityTtlSeconds: 300,
  recoveryMs: 30 * 24 * 60 * 60 * 1000,
} as const;
```

Define stable errors for invalid input/path/type/limit/checksum/manifest, idempotency and state conflicts, not found, origin, scope, storage unavailable, and internal failure. Public errors carry only safe message, status, and retryable state.

- [ ] **Step 3: Implement pure validation**

Normalize paths to NFC without converting backslashes. Validate UTF-8 byte lengths and every segment. Normalize origins by requiring production HTTPS, no credentials/path/query/hash, lowercase host, default-port removal, sort/dedupe, and a 20-origin cap. Maintain separate explicit HTML-package and safe-download extension/MIME maps. Verify signatures where available and stream-decode text as UTF-8.

- [ ] **Step 4: Implement canonical hashes**

Sort manifest files by path and hash newline-delimited `path`, MIME, bytes, and lowercase SHA-256. Fingerprint mutations from canonical JSON with sorted keys and normalized origins, never raw content.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
npm run typecheck
git add app/lib/artifacts
git commit -m "feat: validate artifact packages"
```

### Task 4: Private R2 Object Store and Owned Artifact Repository

**Files:**
- Create: `app/lib/artifacts/object-store.server.ts`, `app/lib/artifacts/repository.server.ts`
- Create: `test/worker/artifact-object-store.test.ts`, `test/worker/artifact-repository.test.ts`

**Interfaces:**
- Produces `artifactObjectKey(artifactId, versionId, path)` with exact shape `artifacts/{artifactId}/versions/{versionId}/{path}`.
- Produces checksum-enforced R2 writes/reads/deletes and owned D1 upload/artifact/version/gallery/lease/idempotency queries.
- Produces D1 batches for new artifact, existing version, and link finalization.

- [ ] **Step 1: Write failing R2 and cross-user tests**

Prove a wrong SHA-256 is rejected, MIME is stored only in `httpMetadata`, keys cannot escape the immutable prefix, and no uploaded source appears in metadata. Seed two users and assert user A cannot read or mutate user B's project, upload, artifact, version, lease, or idempotency row. Assert gallery lookup resolves only `galleryVersionId`.

- [ ] **Step 2: Implement the object-store surface**

```ts
export function artifactObjectKey(artifactId: string, versionId: string, path: string): string;
export async function putLeasedObject(
  env: Env,
  input: { r2Key: string; body: ReadableStream | ArrayBuffer | string; mimeType: string; sha256: string },
): Promise<{ byteSize: number; sha256: string }>;
export async function getVersionObject(env: Env, prefix: string, path: string): Promise<R2ObjectBody | null>;
export async function deleteKeys(env: Env, keys: string[]): Promise<void>;
```

Pass the declared lowercase checksum to `R2Bucket.put`, set only `httpMetadata.contentType`, compare the returned checksum, and inspect the stored object after upload. Never accept an R2 key from HTTP or MCP input.

- [ ] **Step 3: Implement direct ownership predicates**

Every private function begins `(env: Env, userId: string, ...)` and includes the owner predicate in the same SQL query as the target ID. Gallery queries require `visibility = "gallery"`, `deletedAt IS NULL`, and the exact gallery-version join; they never read the current pointer.

- [ ] **Step 4: Implement atomic D1 batches**

Use `env.DB.batch`. New finalization inserts artifact with null current pointer, version 1, file rows, current pointer, complete upload status, and lease deletion atomically. Existing finalization derives `MAX(version_number) + 1` under an owned artifact predicate and moves only current. Link creation writes artifact/version/current atomically. Unique version races map to retryable `state_conflict`. No finalization batch changes gallery state.

- [ ] **Step 5: Verify and commit**

```bash
npm run test:worker -- test/worker/artifact-object-store.test.ts test/worker/artifact-repository.test.ts
npm run typecheck
git add app/lib/artifacts/object-store.server.ts app/lib/artifacts/repository.server.ts test/worker
git commit -m "feat: add private artifact storage boundaries"
```

### Task 5: Upload Sessions, Finalization, Links, and Text Packages

**Files:**
- Create: `app/lib/artifacts/service.server.ts`
- Create: `app/lib/artifacts/__tests__/service-contract.test.ts`, `test/worker/artifact-service.test.ts`

**Interfaces:**
- Produces `createUploadSession`, `putUploadFile`, `finalizeUpload`, `abortUpload`, `createLinkArtifact`, `createLinkArtifactVersion`, `createTextArtifact`, and `createTextArtifactVersion`.
- Browser and MCP paths converge on the same validation, R2, D1, manifest, and idempotency functions.

- [ ] **Step 1: Lock the service contract with failing tests**

Use these signatures:

```ts
createUploadSession(env, userId, input): Promise<UploadSessionResult>
putUploadFile(env, userId, uploadId, input, body): Promise<UploadedFileResult>
finalizeUpload(env, userId, uploadId): Promise<ArtifactMutationResult>
abortUpload(env, userId, uploadId): Promise<void>
createLinkArtifact(env, userId, input): Promise<ArtifactMutationResult>
createLinkArtifactVersion(env, userId, input): Promise<ArtifactMutationResult>
createTextArtifact(env, userId, input): Promise<ArtifactMutationResult>
createTextArtifactVersion(env, userId, input): Promise<ArtifactMutationResult>
```

Browser project selection is `{ projectId } | { projectDraft: { title; oneLiner? } }`; MCP text inputs require existing `projectId`. Reject caller identity, IDs, version numbers, R2 keys, source, and visibility.

- [ ] **Step 2: Implement session creation and leased file reservation**

Validate ownership or normalize an inline draft before generating upload/artifact/version UUIDs. Same owned idempotency key plus fingerprint returns the session; changed fingerprint conflicts. Before R2, conditionally insert a lease only if server-recorded completed files plus leases remain within package limits. Same path/checksum is idempotent; changed bytes conflict.

- [ ] **Step 3: Stream, inspect, and record files**

Require normalized path, MIME, byte size, and SHA-256. Let R2 verify the stream checksum, then read it for signature or streaming UTF-8 inspection. Delete immediately on inspection failure. Insert `artifact_upload_files` only after success and retain the lease through finalization.

- [ ] **Step 4: Finalize from server state only**

Conditionally transition `pending -> finalizing`, load only recorded files, revalidate manifest/aggregate, and run the correct D1 batch. Inline `seed` project creation is in that batch. `complete` retries return the same result. Invalid manifest becomes `failed`; infrastructure failures remain retryable and expose no partial artifact.

- [ ] **Step 5: Implement links and MCP text writes**

Normalize HTTPS links and create new link artifacts or retained link versions without upload sessions. Existing-link input requires the same owned artifact, keeps its project/type fixed, moves only current, and never changes gallery. UTF-8 encode MCP files, infer/validate MIME, apply 100-file/2-MB limits, create leases, write immutable objects, and use the same finalization batches. Scope mutation idempotency to user, operation, target, and caller key with canonical fingerprint comparison.

- [ ] **Step 6: Prove failure ordering and commit**

Test R2-before-D1 failure, D1-after-R2 failure, duplicate finalization, concurrent version conflict, incomplete manifest, pending/failed unreadability, and failed inline-project invisibility. Every unreachable object must retain a cleanup lease.

```bash
npm test -- app/lib/artifacts/__tests__/service-contract.test.ts
npm run test:worker -- test/worker/artifact-service.test.ts
npm run typecheck
git add app/lib/artifacts/service.server.ts app/lib/artifacts/__tests__ test/worker/artifact-service.test.ts
git commit -m "feat: finalize versioned artifact uploads"
```

### Task 6: Lifecycle, Reads, and Privacy-Safe Presenters

**Files:**
- Modify: `app/lib/artifacts/service.server.ts`
- Create: `app/lib/artifacts/presenters.server.ts`
- Create: `app/lib/artifacts/__tests__/presenters.test.ts`, `test/worker/artifact-lifecycle.test.ts`

**Interfaces:**
- Produces metadata update, restore version, share/update/unshare gallery, soft delete/recovery, owned/gallery/detail/version reads, and presenter shapes.

- [ ] **Step 1: Write the failing lifecycle state table**

Cover private creation, share, upload after share, current restore, gallery update, gallery removal, soft delete, recovery within 30 days, expired recovery rejection, and public rejection. At every state owners resolve current, participants resolve only gallery, and deleted artifacts resolve to neither.

- [ ] **Step 2: Implement exact transitions**

Metadata trims/caps title/description without a version. Restore requires a retained version of the same owned artifact and moves current only. Share atomically sets `gallery` plus exact version; removal sets private and clears it. Soft delete hides immediately; recovery clears deletion only within 30 days.

- [ ] **Step 3: Implement presenters**

Owner shapes expose IDs, project ID/title, metadata, type, current/gallery version summary, visibility, update time, and stable URL. Gallery shapes add participant display name but no email/user ID and expose only the shared version. Detail/version shapes expose normalized origins and file path/MIME/size/checksum but never R2 keys, leases, or claims.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- app/lib/artifacts/__tests__/presenters.test.ts
npm run test:worker -- test/worker/artifact-lifecycle.test.ts
npm run typecheck
git add app/lib/artifacts/service.server.ts app/lib/artifacts/presenters.server.ts app/lib/artifacts/__tests__ test/worker/artifact-lifecycle.test.ts
git commit -m "feat: add artifact lifecycle and sharing"
```

---

## Milestone 2: Website API and Upload Experience

### Task 7: Central Origin Guard and Stable HTTP Errors

**Files:**
- Create: `app/lib/request-security.server.ts`, `app/lib/artifacts/http.server.ts`, `workers/react-router.ts`
- Modify: `workers/app.ts`, existing unsafe-route tests
- Create: `app/lib/__tests__/request-security.test.ts`, `app/routes/__tests__/artifact-origin.test.ts`

**Interfaces:**
- Produces `assertWebsiteWriteOrigin` before React Router handles unsafe methods and `artifactJsonAction` for stable JSON errors.

- [ ] **Step 1: Audit and lock all existing website actions**

Enumerate actions from `app/routes.ts`. Parameterize login, logout, welcome, project, chat, thread, feedback, admin, and artifact actions: allowed site origin passes; missing, `null`, renderer, and unrelated origins return 403 before mocked services. GET/HEAD/OPTIONS are unchanged. Worker-level OAuth/MCP endpoints remain outside this wrapper.

- [ ] **Step 2: Implement the guard**

```ts
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export function assertWebsiteWriteOrigin(request: Request, env: Env): void {
  if (!UNSAFE.has(request.method.toUpperCase())) return;
  const allowed = new Set(env.WEB_ALLOWED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean));
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null" || !allowed.has(origin)) {
    throw new Response("Forbidden", { status: 403 });
  }
}
```

Move request-handler construction to `workers/react-router.ts`; call the guard before route logic. `workers/app.ts` delegates website requests there so the later MCP/OAuth wrapper can reuse it.

- [ ] **Step 3: Lock host-only cookies and errors**

Extend auth/Google tests: HTTPS session/state cookies include Secure, HttpOnly, SameSite=Lax, and never `Domain=`. `artifactJsonAction` serializes only known safe `ArtifactError` fields; unknown exceptions become redacted `internal_error` 500.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- app/lib/__tests__/request-security.test.ts app/routes/__tests__ app/lib/__tests__/auth.test.ts
npm run typecheck
git add app/lib/request-security.server.ts app/lib/artifacts/http.server.ts workers app/routes/__tests__ app/lib/__tests__
git commit -m "security: require exact origins for website writes"
```

### Task 8: Browser Artifact Resource Routes

**Files:**
- Create: `app/routes/api.artifact-uploads.ts`, `api.artifact-uploads.$uploadId.files.ts`, `api.artifact-uploads.$uploadId.finalize.ts`, `api.artifact-uploads.$uploadId.abort.ts`
- Create: `app/routes/api.artifacts.links.ts`, `api.artifacts.$artifactId.link-version.ts`, `api.artifacts.$artifactId.ts`, `api.artifacts.$artifactId.restore-version.ts`, `api.artifacts.$artifactId.gallery.ts`, `api.artifacts.$artifactId.capability.ts`
- Modify: `app/routes.ts`
- Create: `app/routes/__tests__/artifact-api.test.ts`

**Interfaces:**
- Routes authenticate/parse only and always pass session `user.id` to the service.
- File PUT uses `X-Artifact-Path`, `X-Artifact-Mime`, `X-Artifact-Bytes`, and `X-Artifact-SHA256`.

- [ ] **Step 1: Write failing delegation/privacy tests**

Assert auth precedes parsing/service work, identity cannot come from input, malformed JSON/headers map safely, foreign records stay indistinguishable, and responses contain no user ID, R2 key, lease, or claims.

- [ ] **Step 2: Register exact routes**

```text
POST   /api/artifact-uploads
PUT    /api/artifact-uploads/:uploadId/files
POST   /api/artifact-uploads/:uploadId/finalize
POST   /api/artifact-uploads/:uploadId/abort
POST   /api/artifacts/links
POST   /api/artifacts/:artifactId/link-version
PATCH  /api/artifacts/:artifactId
DELETE /api/artifacts/:artifactId
POST   /api/artifacts/:artifactId                  intent=restore-deleted
POST   /api/artifacts/:artifactId/restore-version
PUT    /api/artifacts/:artifactId/gallery
DELETE /api/artifacts/:artifactId/gallery
GET    /api/artifacts/:artifactId/capability
```

Link-version POST accepts only a normalized replacement HTTPS URL and idempotency key. PATCH touches metadata only. Gallery PUT requires an exact version. Capability GET first resolves the authenticated viewer's allowed version and returns only `{ previewUrl, expiresAt }`.

- [ ] **Step 3: Enforce body/cache rules**

Reject invalid/missing byte count, SHA-256, MIME, path, or body; compare body and declared size. Cap JSON at 64 KB. Every response uses `Cache-Control: private, no-store`; upload success echoes only server-recorded path/checksum/bytes.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- app/routes/__tests__/artifact-api.test.ts app/routes/__tests__/artifact-origin.test.ts
npm run typecheck
git add app/routes app/routes.ts
git commit -m "feat: expose authenticated artifact resources"
```

### Task 9: Browser ZIP Preparation and Upload Orchestration

**Files:**
- Create: `app/lib/artifacts/package.client.ts`, `app/lib/artifacts/upload.client.ts`
- Create: `app/lib/artifacts/__tests__/package-client.test.ts`, `app/lib/artifacts/__tests__/upload-client.test.ts`

**Interfaces:**
- Produces `prepareArtifactSelection`, advisory `suggestDataOrigins`, and resumable `uploadPreparedPackage`.

- [ ] **Step 1: Create failing ZIP and upload tests**

Generate root HTML/nested asset, traversal, duplicate-NFC, platform metadata, missing-index, symlink/special-mode, 501-file, ordinary-overflow, and aggregate-overflow ZIPs. Cover plain HTML and safe file. Assert URL extraction suggests but never approves origins.

- [ ] **Step 2: Inspect before extracting**

Use Zip.js `ZipReader`/`BlobReader`. Inspect filename, directory, uncompressed size, and Unix external mode before `getData`. Accept only directories/regular files, normalize names, sum sizes, reject duplicates/limits, then extract accepted entries sequentially with `BlobWriter`.

- [ ] **Step 3: Hash, classify, and upload**

Hash each Blob with WebCrypto, infer/validate MIME, map a single `.html` to `index.html`, and keep a sanitized basename for a safe file. Create one idempotent session, upload sequentially with four headers, skip server-confirmed completed paths, then finalize. AbortSignal calls abort. Progress uses server acknowledgements.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- app/lib/artifacts/__tests__/package-client.test.ts app/lib/artifacts/__tests__/upload-client.test.ts
npm run typecheck
git add app/lib/artifacts/package.client.ts app/lib/artifacts/upload.client.ts app/lib/artifacts/__tests__
git commit -m "feat: prepare and stream browser artifacts"
```

### Task 10: Owned Artifact List, Upload/Link Dialog, and Detail Controls

**Files:**
- Modify: `app/routes/artifacts.tsx`
- Create: `app/routes/artifacts.$id.tsx`
- Create: `app/components/artifacts/artifact-upload-dialog.tsx`, `artifact-card.tsx`, `artifact-detail.tsx`, `artifact-version-history.tsx`, `artifact-publish-controls.tsx`
- Modify: `app/routes/garden.projects.$id.tsx`
- Create: `app/routes/__tests__/artifacts.test.tsx`, `app/routes/__tests__/artifact-detail.test.tsx`

**Interfaces:**
- `/artifacts` loader returns owned artifacts grouped by project plus owned projects for selection.
- Detail loader returns owner or gallery-visible detail and version controls only for the owner.

- [ ] **Step 1: Write failing route/component tests**

Assert grouped cards show type/current version/visibility/update time; empty state enables upload; dialog supports existing project, inline seed project, HTML/ZIP/file/link, metadata, confirmed data origins, progress, cancellation, and stable errors. Detail tests cover owner-only metadata/new-version/share/delete controls, including replacement links, gallery reader restrictions, external-origin disclosure, file download, link `noopener noreferrer`, and no inline file renderer.

- [ ] **Step 2: Implement the upload/link dialog**

Keep one progressive dialog with artifact kind first, project second, metadata/origins third, and progress last. HTML/ZIP/file uses Task 9; link calls `/api/artifacts/links`. Literal URLs produce unchecked origin suggestions that require owner confirmation. On success navigate to `/artifacts/{id}` and revalidate lists.

- [ ] **Step 3: Replace the artifacts placeholder**

Load with `requireUser`, `listOwnedArtifacts`, and `listProjects`. Group by project in service order, keep collections under seven visible groups before disclosure, and show accessible type/version/visibility badges. Preserve the existing Tufte-garden visual system.

- [ ] **Step 4: Implement owner detail actions**

Render metadata form, new-version upload, restore exact retained version, explicit share/update version selection, gallery removal, soft delete, and deleted recovery state. Every destructive or open-world action has direct confirmation text. Display allowed origins before the preview area.

- [ ] **Step 5: Add project linkage**

Load live/recoverable artifact summaries on project detail. Show a compact artifact section and an upload action preselecting that project. Do not duplicate artifact mutation logic in the project route.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- app/routes/__tests__/artifacts.test.tsx app/routes/__tests__/artifact-detail.test.tsx
npm run typecheck
git add app/routes/artifacts.tsx 'app/routes/artifacts.$id.tsx' 'app/routes/garden.projects.$id.tsx' app/components/artifacts app/routes/__tests__
git commit -m "feat: add artifact upload and ownership UI"
```

---

## Milestone 3: Capabilities and Isolated Renderer

### Task 11: Signed Capability Codec and Deterministic Renderer Policy

**Files:**
- Create: `app/lib/artifacts/capability.ts`, `app/lib/artifacts/policy.ts`
- Create: `app/lib/artifacts/__tests__/capability.test.ts`, `app/lib/artifacts/__tests__/policy.test.ts`

**Interfaces:**
- Produces `issueCapability`, `verifyCapability`, `buildRendererHeaders`, `buildCsp`, and `buildPermissionsPolicy`.

- [ ] **Step 1: Write failing cryptographic and policy tests**

Round-trip claims; reject payload/signature tampering, expiry, future token/policy versions, mode changes, prefix/entry changes, malformed paths, and a signing secret equal to the session secret. Snapshot deterministic CSP for zero/one/many sorted origins and production/dev parent origins. Assert no wildcard parent/connect policy and no uploaded-header merge path.

- [ ] **Step 2: Implement versioned HMAC claims**

```ts
export type RendererCapability = {
  tokenVersion: 1;
  policyVersion: 1;
  mode: "preview" | "download";
  versionId: string;
  prefix: string;
  entryPath: string;
  allowedDataOrigins: string[];
  exp: number;
};
```

Encode canonical JSON as base64url and append a base64url HMAC-SHA256 signature. Verify structure, signature with constant-time WebCrypto, expiry, exact immutable prefix, normalized entry path/origins, and supported versions. Main issuance refuses empty/equal session and renderer secrets.

- [ ] **Step 3: Build exact renderer policy**

Baseline CSP contains `default-src 'none'`, `base-uri/object-src/frame-src/form-action 'none'`, exact `frame-ancestors`, inline scripts/styles, `'wasm-unsafe-eval'`, `blob:` workers, renderer self, exact static hosts by directive, and exact allowed origins only in `connect-src`. Permissions Policy denies camera, microphone, geolocation, clipboard, payment, USB, Bluetooth, sensors, storage access, presentation, orientation, and pointer lock.

All capability responses add `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cache-Control: private, no-store`. Data/runtime assets add credential-free `Access-Control-Allow-Origin: *`; entry HTML does not.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- app/lib/artifacts/__tests__/capability.test.ts app/lib/artifacts/__tests__/policy.test.ts
npm run typecheck
git add app/lib/artifacts/capability.ts app/lib/artifacts/policy.ts app/lib/artifacts/__tests__
git commit -m "security: sign artifact renderer capabilities"
```

### Task 12: Renderer Worker, Pinned DuckDB Runtime, and Deployment Boundary

**Files:**
- Create: `workers/renderer.ts`, `wrangler.renderer.jsonc`, `scripts/copy-renderer-runtime.mjs`
- Create: `public/renderer/runtime/duckdb/1.33.1-dev57.0/duckdb-browser-eh.worker.js`, `duckdb-eh.wasm`
- Create: `test/worker/renderer.test.ts`

**Interfaces:**
- Renderer surface is only `/v1/{capability}/{relativePath}` and `/runtime/duckdb/1.33.1-dev57.0/{approved-file}`.
- Renderer Env has `ARTIFACTS`, `ASSETS`, `ARTIFACT_METRICS`, `RENDERER_SIGNING_SECRET`, and `PARENT_ORIGIN`, but no D1/session/OAuth bindings.

- [ ] **Step 1: Write failing renderer boundary tests**

Test valid preview entry/relative asset/data CORS, valid attachment download, expiry/tamper/wrong path, top-level preview rejection, missing Fetch Metadata, directory/traversal, absent object, R2 metadata attempting to add headers, runtime allowlist, and fixed error body. Assert errors contain no path/token/source/stack.

- [ ] **Step 2: Copy only the single-thread runtime**

`copy-renderer-runtime.mjs` removes no unrelated files; it creates the version directory and copies exactly `duckdb-browser-eh.worker.js` and `duckdb-eh.wasm` from the pinned package. It verifies package version equals `1.33.1-dev57.0` and exits nonzero otherwise.

- [ ] **Step 3: Implement renderer routing**

For preview entry require `Sec-Fetch-Dest: iframe` and `Sec-Fetch-Mode: navigate`; top-level `document` fails 403. Normalize relative paths under signed prefix, fetch R2, use only recorded `httpMetadata.contentType`, apply Task 11 headers, and stream body. Download mode serves only signed entry path with attachment filename. Runtime route has a literal two-file allowlist and immutable one-year cache; every other route is fixed 404.

- [ ] **Step 4: Configure isolated deployment**

Create `wrangler.renderer.jsonc` with `main: "./workers/renderer.ts"`, name `vibe-garden-renderer`, same private R2 bucket, Analytics Engine, static assets binding rooted at `public/renderer`, `run_worker_first: true`, `PARENT_ORIGIN: "https://vibegarden.club"`, and custom-domain route `usercontent.vibegarden.club`. Set `observability.enabled: false` to avoid platform capture of capability paths. Do not add D1, session, OAuth, mail, or website variables.

- [ ] **Step 5: Verify and commit**

```bash
npm run copy:renderer-runtime
npm run test:worker -- test/worker/renderer.test.ts
npm run cf-typegen
npm run typecheck
git add workers/renderer.ts wrangler.renderer.jsonc scripts/copy-renderer-runtime.mjs public/renderer test/worker/renderer.test.ts
git commit -m "feat: add isolated artifact renderer"
```

### Task 13: Authenticated Preview, Full-Screen Wrapper, Downloads, and Gallery

**Files:**
- Modify: `app/routes/api.artifacts.$artifactId.capability.ts`, `app/routes/artifacts.$id.tsx`, `app/routes/gallery.tsx`, `app/routes.ts`
- Create: `app/routes/artifacts.$id.fullscreen.tsx`, `app/routes/artifacts.$id.download.ts`, `app/components/artifacts/artifact-frame.tsx`, `app/components/artifacts/gallery-card.tsx`
- Create: `app/routes/__tests__/artifact-rendering.test.tsx`, `app/routes/__tests__/gallery.test.tsx`

**Interfaces:**
- Produces sandboxed `ArtifactFrame` with five-minute authenticated refresh.
- Produces stable detail/full-screen wrappers and website-controlled attachment downloads.

- [ ] **Step 1: Write failing wrapper/gallery tests**

Assert exact `sandbox="allow-scripts"`, no dangerous tokens, no renderer direct link, full-screen points to website wrapper, capability URL never renders as text, expired capability refreshes through same-origin authenticated loader, gallery cards do not load iframes, and gallery viewers get shared version while owners get current. File/link behaviors remain download/new-tab only.

- [ ] **Step 2: Issue viewer-bound capability URLs**

Resolve owner current or participant gallery version first. For HTML issue preview claims; for file downloads issue download claims; reject link capabilities. Build URL from configured renderer origin, never request host. Return no-store data and refresh 30 seconds before expiry.

- [ ] **Step 3: Implement wrappers**

`ArtifactFrame` renders only sandboxed iframe and a fixed loading/error state. Full-screen route requires user, resolves visible detail, and renders a full-viewport website page containing the same frame. Download route requires user, issues mode download, and 302 redirects to renderer; no uploaded file is streamed from `vibegarden.club`.

- [ ] **Step 4: Replace gallery placeholder**

Loader requires auth and calls `listGalleryArtifacts`. Cards show title, description, type, project, participant display name, and exact shared version without iframe. Selection opens `/artifacts/{id}`. Empty state remains when no shares exist.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- app/routes/__tests__/artifact-rendering.test.tsx app/routes/__tests__/gallery.test.tsx app/routes/__tests__/artifact-detail.test.tsx
npm run typecheck
git add app/routes app/components/artifacts
git commit -m "feat: render authenticated artifacts safely"
```

---

## Milestone 4: Retention, MCP Writes, and Release Verification

### Task 14: Cleanup, Project Deletion Restriction, and Safe Observability

**Files:**
- Create: `app/lib/artifacts/cleanup.server.ts`, `app/lib/artifacts/observability.server.ts`
- Modify: `workers/app.ts`, `app/lib/projects.server.ts`, `app/routes/garden.projects.$id.tsx`
- Create: `test/worker/artifact-cleanup.test.ts`, `app/lib/artifacts/__tests__/observability.test.ts`

**Interfaces:**
- Produces idempotent `cleanupArtifacts(env, now, batchSize = 100)`.
- Produces allowlisted `recordArtifactEvent` and `writeArtifactMetric`.
- Project deletion throws a typed live/recoverable-artifact conflict.

- [ ] **Step 1: Write failing cleanup and log-redaction tests**

Seed pending/finalizing/failed/aborted sessions on each side of expiry, orphan leases with/without objects, soft deletes on each side of 30 days, partial R2 delete failures, and live versions. Run cleanup twice. Assert only expired targets disappear, failures retry, live objects survive, and logs/metrics contain only allowlisted fields.

- [ ] **Step 2: Implement bounded cleanup order**

Process at most 100 records per category: expired upload files and leases, standalone expired leases, then expired soft-deleted artifact files/metadata. Delete R2 keys first; delete D1 rows only after successful/absent object deletion. Record IDs/counts/bytes/outcomes, never key/path/content. Re-running is safe.

- [ ] **Step 3: Compose scheduled work**

Add `scheduled` to `workers/app.ts` and call cleanup through `ctx.waitUntil`. If the MCP OAuth cleanup cron already exists, run both promises with `Promise.allSettled` so one subsystem does not suppress the other; each logs its own safe outcome.

- [ ] **Step 4: Restrict project deletion**

Before delete, query for any artifact row, including a recoverable soft delete. Return a typed conflict and render UI guidance to permanently wait for cleanup or restore/remove the artifact. The D1 restricted foreign key remains the final enforcement layer.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- app/lib/artifacts/__tests__/observability.test.ts app/routes/__tests__/artifact-detail.test.tsx
npm run test:worker -- test/worker/artifact-cleanup.test.ts
npm run typecheck
git add app/lib/artifacts/cleanup.server.ts app/lib/artifacts/observability.server.ts workers/app.ts app/lib/projects.server.ts 'app/routes/garden.projects.$id.tsx' test/worker app/lib/artifacts/__tests__
git commit -m "feat: clean up retained artifact data"
```

### Task 15: OAuth-Authenticated MCP Artifact Tools

**Prerequisite:** The approved Gardener MCP server plan has landed, including OAuth token properties, scopes, `runMcpTool`, deterministic registration, workerd OAuth tests, and consent UI.

**Files:**
- Modify: `app/lib/mcp/contracts.ts`, `app/lib/mcp/server.server.ts`, `app/routes/oauth.authorize.tsx`
- Create: `app/lib/mcp/artifact-presenter.server.ts`, `app/lib/mcp/__tests__/artifact-tools.test.ts`, `test/worker/mcp-artifacts.test.ts`
- Modify: MCP integration tests and public connection/privacy docs from the companion plan

**Interfaces:**
- Adds scopes `artifacts:write` and `artifacts:publish` without changing read scopes.
- Registers `create_artifact`, `create_artifact_version`, and `share_artifact` in deterministic order.

- [ ] **Step 1: Write failing schema/scope/isolation tests**

Assert exact JSON schemas, non-destructive bounded write annotation for create/version, open-world impact annotation for share, independent scopes/challenges, token user authority, cross-user project/artifact/version rejection, idempotent retry/conflict, current/gallery separation, 100-file/2-MB bounds, root index, and responses without user/R2 fields.

- [ ] **Step 2: Add exact tool inputs**

`create_artifact` requires existing `project_id`, title, optional description, non-empty `{ path, content, mime_type? }[]`, optional allowed data origins, and caller idempotency key. It creates HTML only and requires root `index.html`. `create_artifact_version` requires owned HTML artifact ID, replacement text files, optional origins, and key. `share_artifact` requires owned artifact ID, exact retained version ID, and `confirm: true`.

- [ ] **Step 3: Delegate to the domain service**

Handlers extract only verified OAuth principal, require the exact scope, and call `createTextArtifact`, `createTextArtifactVersion`, or `shareArtifactVersion`. Creation returns artifact/version summary plus canonical authenticated detail URL. Version creation does not touch gallery. Recalling share with another exact version updates gallery; website removal remains the initial unshare path.

- [ ] **Step 4: Extend consent and public documentation**

Describe private artifact creation separately from authenticated-gallery publication. Existing grants require reauthorization for new scopes. Document file/count limits, retained versions, operational logging, revocation, and that binary MCP import/file pickers remain deferred.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- app/lib/mcp/__tests__/artifact-tools.test.ts
npm run test:worker -- test/worker/mcp-artifacts.test.ts
npm run typecheck
git add app/lib/mcp app/routes/oauth.authorize.tsx test/worker README.md app/routes
git commit -m "feat: add authenticated MCP artifact writes"
```

### Task 16: Browser Security Fixtures, End-to-End Flows, Documentation, and Deployment Gate

**Files:**
- Create: `playwright.config.ts`, `wrangler.security.jsonc`, `test/security/fixture-worker.ts`, `test/security/fixtures/forbidden.html`, `test/security/fixtures/positive.html`, `test/security/artifact-boundary.spec.ts`, `test/security/artifact-flows.spec.ts`
- Modify: `README.md`, `docs/ROADMAP.md`
- Create: `docs/runbooks/artifact-renderer.md`

**Interfaces:**
- Produces automated negative/positive browser proof and a repeatable deployment/rollback runbook.

- [ ] **Step 1: Build the two-host security harness**

Use one local fixture Worker that dispatches by hostname: `vibegarden.test` serves authenticated wrappers/seed endpoints and `usercontent.vibegarden.test` invokes the real renderer handler against the same local R2. Configure Chromium host resolver rules to map both to 127.0.0.1. Use explicit parent/renderer origins and a dedicated test signing secret.

- [ ] **Step 2: Add mandatory forbidden fixture assertions**

The uploaded fixture reports attempts through `postMessage`. Prove it cannot read/modify parent DOM; read website/renderer cookies, localStorage, IndexedDB, or same-origin storage; submit forms; open popups; navigate top; call website writes with session; fetch undeclared origin; create nested frames; or use camera, microphone, geolocation, clipboard, payment, USB, and denied capabilities. Prove direct top-level renderer entry and expired/tampered capabilities fail safely.

- [ ] **Step 3: Add positive renderer assertions**

Prove relative HTML/CSS/JS/images/fonts load, packaged CSV and Parquet are readable by the pinned DuckDB runtime, declared CORS-enabled remote CSV works, the same source fails undeclared, capability refresh preserves wrapper state, and downloads are attachments.

- [ ] **Step 4: Add end-to-end product flows**

Cover single HTML, ZIP expansion, safe file, HTTPS link, existing/inline seed project, metadata edit, retained version, restore, stable URLs, private default, share, pinned gallery after new upload, gallery update/removal, detail/full-screen wrappers, deletion/recovery, and the Task 15 MCP create/version/retry/share/insufficient-scope flows.

- [ ] **Step 5: Update documentation and roadmap**

Document local R2 setup, both Workers, origins, secrets, runtime-copy step, migrations, cleanup, CSP/static-host review process, connector scopes, and incident rollback. Author guidance requires pinned dependency URLs and integrity metadata where the provider supports it, and recommends packaging bounded data when remote CORS fails. Mark Phase 5 upload/gallery items complete only after production verification. Keep the email-sender caveat explicit.

- [ ] **Step 6: Run the complete release gate**

```bash
npm run copy:renderer-runtime
npm test
npm run test:worker
npm run test:security
npm run typecheck
npm run build
npx wrangler deploy --config wrangler.renderer.jsonc --dry-run
npx wrangler deploy --dry-run
git diff --check
git status --short
```

Expected: all tests and builds pass; renderer dry-run contains no D1/session/OAuth binding; main and renderer share only R2, signing secret, and metrics; production parents/origins are exact; no public bucket config exists; diff contains no unrelated changes.

- [ ] **Step 7: Provision and deploy in safe order**

```bash
npx wrangler r2 bucket create vibe-garden-artifacts
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put RENDERER_SIGNING_SECRET
npx wrangler secret put RENDERER_SIGNING_SECRET --config wrangler.renderer.jsonc
npm run deploy:renderer
npm run deploy
```

Use the same new dedicated signing value in both deployments and verify it differs from the session secret without printing either. Verify `usercontent.vibegarden.club`, private bucket settings, security headers, OTP delivery, upload/share/refresh/download, cleanup telemetry, and cross-user isolation before marking the roadmap complete.

- [ ] **Step 8: Commit the release proof**

```bash
git add playwright.config.ts wrangler.security.jsonc test/security README.md docs/ROADMAP.md docs/runbooks/artifact-renderer.md
git commit -m "test: verify artifact rendering boundary"
```

---

## Self-Review

- **Spec coverage:** Tasks 2 through 6 cover the D1/R2 model, immutable versions, upload state, private/current/gallery semantics, inline projects, safe files/links, deletion, and idempotency. Tasks 7 through 10 cover exact-origin website APIs and browser UX. Tasks 11 through 13 cover signed capabilities, isolated renderer, CSP/CORS/sandbox, DuckDB-Wasm, downloads, wrappers, and gallery. Tasks 14 through 16 cover cleanup, observability, project deletion, MCP scopes/tools, browser security, E2E flows, configuration assertions, documentation, and deployment.
- **Boundary coverage:** The renderer has no D1 or session dependency; no website page opens renderer HTML directly; owner and gallery pointer resolution is tested separately; pending, failed, deleted, foreign, and unshared versions are never served.
- **Type consistency:** `ArtifactMutationResult`, manifest/file types, capability claims, service names, route payloads, and the three MCP method names remain consistent across tasks.
- **Dependency consistency:** Browser ZIP handling uses only Zip.js; renderer DuckDB files come from the exactly pinned package; Worker integration tests share the generic harness with the companion MCP work.
- **No-placeholder check:** Every task names concrete files, interfaces, test cases, commands, expected behavior, and a commit boundary. Deferred binary MCP import, anonymous public sharing, inline non-HTML renderers, comments, multithread DuckDB, and mail-sender migration remain explicit non-goals from the approved design, not unfinished steps in this plan.
