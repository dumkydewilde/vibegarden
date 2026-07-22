# Artifact Upload and Rendering Architecture

**Date:** 2026-07-18
**Status:** Approved in conversation; written review pending

## Summary

Add project-owned, versioned artifacts to Vibe Garden. Interactive HTML is the
primary artifact type; safe downloadable files and external links are also
supported. Every artifact belongs to an Idea Garden project, starts private,
and may be shared explicitly with authenticated participants in the gallery.

Artifact metadata and version state live in D1. Immutable version files live
in a private R2 bucket. Untrusted HTML is rendered only through a dedicated
Worker at `usercontent.vibegarden.club`, inside a sandboxed iframe on an
authenticated Vibe Garden detail or full-screen wrapper page.

Website uploads and OAuth-authenticated MCP tools use the same artifact domain
service. The browser supports HTML files, ZIP packages, safe files, and links.
The initial MCP tools accept bounded text-file collections as already reserved
by the Gardener MCP server design; binary MCP import remains deferred.

## Decisions

- Interactive HTML is the primary artifact type.
- Browser uploads accept a single HTML file or a ZIP with `index.html` and
  relative local assets or data.
- Safe downloadable files and HTTPS links are also artifact types.
- Every artifact belongs to exactly one project. A browser upload may create a
  new `seed` project inline; MCP artifact creation requires an existing owned
  project.
- Artifacts are private by default. Gallery sharing is explicit and remains
  limited to authenticated participants.
- Each artifact has a stable ID and URL with retained immutable versions.
- The owner's current version and the gallery's shared version are separate
  pointers. A write never updates gallery content implicitly.
- R2 remains private. A dedicated renderer Worker streams exact version files
  through short-lived signed capabilities.
- The initial renderer hostname is `usercontent.vibegarden.club`.
- Public anonymous sharing is reserved in the schema but disabled until the
  renderer moves to a separate registrable domain, such as
  `vibegardenusercontent.com`.
- Static dependencies use a platform allowlist. Runtime data connections use
  explicit per-version origin declarations.
- DuckDB-Wasm is a supported, Vibe Garden-hosted runtime dependency. Packaged
  data works without external network access; remote data must satisfy the
  artifact CSP and the source server's CORS policy.
- MCP authentication follows the existing OAuth 2.1 design. Artifact creation
  requires `artifacts:write`; gallery sharing requires
  `artifacts:publish`.
- Implementation creates a root `AGENTS.md` containing the artifact security
  invariants and the tests required before changing them.

## Goals

1. Let a participant upload and safely view an interactive HTML artifact.
2. Let HTML artifacts include multiple local assets and data files.
3. Let a participant attach a safe file or external link to a project.
4. Keep a stable artifact URL while retaining every successful version.
5. Let owners choose a specific version to share with the authenticated
   gallery.
6. Give the future MCP write milestone the same storage, validation,
   versioning, and authorization behavior as the website.
7. Support browser-side DuckDB visualizations without granting artifacts
   unrestricted network access.
8. Establish a security boundary suitable for opening the application to more
   participants later.

## Non-goals

- Editing HTML in Vibe Garden.
- Asking the in-site Gardener to generate or save artifacts directly.
- Anonymous public artifact URLs.
- Running uploaded server-side code.
- Treating artifact storage as a general dataset-ingestion service.
- Virus scanning arbitrary binaries or accepting executable downloads.
- MCP binary upload in the initial write milestone.
- An MCP App file picker in the initial write milestone.
- Server-side DuckDB or MotherDuck execution for artifacts.
- Artifact comments in this milestone. The existing comment target type remains
  reserved for a later detail-page addition.

## Architecture

### Deployments and trust boundaries

```text
Website browser or MCP host
          |
          v
Main Vibe Garden Worker ------------------------ D1
  website, OAuth/MCP, artifact service            metadata and version state
          |
          +-------------------------------------- private R2
                                                   immutable version files

Authenticated detail or full-screen wrapper
          |
          | short-lived signed preview capability
          v
Renderer Worker: usercontent.vibegarden.club
          |
          +-------------------------------------- private R2
```

The existing Worker at `vibegarden.club` remains responsible for website
authentication, OAuth/MCP, project ownership, upload orchestration, artifact
metadata, gallery authorization, and preview-capability issuance.

The renderer is a second Worker deployment with a deliberately narrow surface:

- Validate a signed, expiring capability.
- Resolve a safe relative path beneath one immutable version prefix.
- Stream that object from private R2 with the recorded MIME type.
- Apply renderer-owned security headers and the version's network policy.

The renderer has no website routes, mutation endpoints, D1 query surface,
session-cookie dependency, or access to the website session secret. The main
Worker and renderer share the private R2 bucket through bindings. They use a
dedicated renderer-signing secret that is not reused for sessions or OAuth.

### Components

1. **Artifact service:** Authoritative ownership, validation, versioning,
   publication, and deletion logic shared by website routes and MCP tools.
2. **Upload-session service:** Coordinates resumable, idempotent browser file
   uploads and finalization without exposing partial artifacts.
3. **Artifact repository:** D1 access functions that always include the
   authenticated `userId` for private mutations and reads.
4. **Artifact object store:** R2 key construction, streaming writes, reads,
   checksums, and cleanup.
5. **Renderer capability service:** Issues and verifies short-lived HMAC-signed
   version capabilities.
6. **Renderer Worker:** Serves capability-scoped entry documents and assets
   with sandbox-oriented headers.
7. **Artifact presenters:** Shape owned-list, gallery, detail, version-history,
   HTTP API, and MCP responses without exposing R2 keys or user IDs.

Each component has one boundary. Route and MCP handlers authenticate and parse
inputs, then call the artifact service; they do not implement storage or
authorization rules themselves.

## Artifact and Version Model

### Artifact types

| Type | Version content | Viewer behavior |
|---|---|---|
| `html` | `index.html` plus an optional relative file tree | Sandboxed preview and full-screen wrapper |
| `file` | Exactly one safe downloadable file | Metadata plus download action |
| `link` | Exactly one normalized HTTPS URL | Metadata plus external-link action |

An artifact's type does not change between versions. Title, description, and
project are artifact metadata; changing them does not create a version.
Changing HTML/package contents, the downloadable file, or the external URL
creates an immutable version.

### D1 tables

#### `artifacts`

- `id`
- `user_id`
- `project_id`, required, foreign key with delete restricted
- `type`: `html`, `file`, or `link`
- `title`
- `description`, nullable
- `visibility`: `private`, `gallery`, or reserved `public`
- `current_version_id`
- `gallery_version_id`, nullable
- `deleted_at`, nullable
- `created_at`
- `updated_at`

`user_id` is retained even though the project has an owner so every private
artifact query can use a direct ownership predicate. `public` is not accepted
by application or MCP input in this release.

#### `artifact_versions`

- `id`
- `artifact_id`
- `version_number`, monotonically increasing per artifact
- `source`: `web` or `mcp`
- `entry_path`, required for HTML and file artifacts
- `external_url`, required only for link artifacts
- `allowed_data_origins`, normalized JSON array
- `file_count`
- `total_bytes`
- `created_by`
- `created_at`

Every version row represents successfully finalized content and is immutable.
Pending and failed browser work lives only in the upload tables. Restoring a
version changes an artifact pointer; it does not mutate or copy the version.

#### `artifact_files`

- `version_id`
- `path`, normalized relative path, unique within a version
- `r2_key`, unique
- `mime_type`
- `byte_size`
- `sha256`
- `created_at`

R2 keys use the immutable form:

```text
artifacts/{artifactId}/versions/{versionId}/{relativePath}
```

#### `artifact_uploads`

- `id`
- `user_id`
- Generated `artifact_id` and `version_id`
- Existing artifact/project reference or validated new-project draft
- Proposed artifact type, title, description, and allowed data origins
- `status`: `pending`, `finalizing`, `complete`, `failed`, or `aborted`
- Idempotency key
- Expiry, creation, and update timestamps

#### `artifact_upload_files`

- `upload_id`
- Normalized relative path
- R2 key
- MIME type
- Byte size
- SHA-256 checksum
- Upload timestamp

These rows make retries, manifest verification, and orphan cleanup independent
of client-provided finalization data.

## Version and Publication Semantics

- A successful new upload creates a ready version and moves
  `current_version_id`.
- `gallery_version_id` changes only through an explicit share operation.
- Sharing a private artifact sets visibility to `gallery` and chooses an exact
  ready version.
- Uploading or restoring a current version never changes what the gallery
  shows.
- Updating the gallery is an explicit operation that sets
  `gallery_version_id` to a chosen ready version.
- Removing an artifact from the gallery sets visibility to `private` and clears
  `gallery_version_id` without deleting content.
- Owners see `current_version_id`. Other authenticated participants see only
  `gallery_version_id`.
- Stable detail URLs use `/artifacts/{artifactId}`. The full-screen wrapper uses
  `/artifacts/{artifactId}/fullscreen`; both resolve the correct visible
  version for the current viewer.

This separation ensures an MCP call with only `artifacts:write` cannot replace
already shared content. Gallery changes require `artifacts:publish`.

## Browser Upload API and Flows

All cookie-authenticated unsafe requests require an exact allowed website
origin. The production origin is `https://vibegarden.club`; local development
origins are explicit configuration rather than wildcards.

### Resource routes

- Create an upload session.
- Stream one file to a session at a normalized relative path.
- Finalize or abort a session.
- Create a link artifact or link version.
- Update artifact title and description.
- Restore a retained version.
- Share a chosen version, update the gallery version, or remove gallery
  visibility.
- Soft-delete or restore an artifact during its recovery window.
- List owned artifacts, authenticated gallery artifacts, and retained versions.
- Read owned or gallery-visible artifact details.

Concrete URLs follow existing React Router resource-route conventions. Route
names are not part of the durable domain contract; input/output schemas and
service behavior are.

### New HTML, ZIP, or file artifact

1. The participant selects an existing project or enters a new project name
   and optional one-line description. A new project will have `seed` status.
2. The participant chooses an HTML file, ZIP package, or safe downloadable
   file and enters artifact title, description, and permitted data origins.
3. The browser requests an upload session. The service validates ownership or
   stores the new-project draft, then generates the eventual artifact and
   version IDs.
4. For ZIP packages, the browser expands the archive locally. It rejects an
   invalid entry point, traversal, file-count overflow, and expanded-size
   overflow before upload.
5. The browser streams files individually. The Worker independently validates
   every path, type, size, checksum, session owner, and aggregate limit before
   writing to the immutable target prefix.
6. Finalization compares the server-recorded uploaded files with the expected
   artifact shape. In one D1 transaction it optionally creates the project,
   creates the artifact/version/file records, updates the current pointer, and
   marks the session complete.
7. Only a completed version becomes visible. If finalization fails, no artifact
   or inline-created project is exposed; unreachable R2 objects are cleanup
   candidates.

The server does not expand ZIPs inside the Worker isolate. This avoids holding
compressed and expanded package contents inside the Worker memory limit while
retaining independent server-side enforcement of the expanded result.

### New link artifact

Link creation needs no upload session. The service validates the owned project,
normalizes an HTTPS URL, and creates the optional new `seed` project, artifact,
and first version in one D1 transaction.

### New version

An owned artifact fixes the type and project. A browser upload session targets
the existing artifact, assigns the next version number during finalization,
and moves only `current_version_id`. Every intentional finalized upload creates
a version; the idempotency key prevents retries of the same upload from
creating duplicates.

## MCP Write Surface

The MCP server design remains authoritative for OAuth 2.1, DCR, PKCE, token
properties, and per-user authorization. MCP tools import the artifact service
directly; they do not call website routes over HTTP.

Every MCP artifact mutation is scoped by both trusted OAuth token properties:
`userId` and the selected `clubId`. Artifact ownership is resolved through the
artifact's project, and repository predicates join through `projects.club_id`.
An owned artifact in another club is therefore indistinguishable from a
missing artifact. The existing artifact tables do not need a duplicated
`club_id` column or a migration for this integration.

### `create_artifact`

Input:

- Required existing `project_id`
- Artifact title and optional description
- One to 100 text files, at most 2 MB aggregate UTF-8 content, as
  `{ path, content, mime_type? }`
- Optional permitted data origins
- Required caller-generated idempotency key

The first release creates HTML artifacts only and therefore exposes no caller
controlled artifact-type field. Its model-generated text package must contain
root `index.html`. The tool validates the owned project, writes immutable R2
objects, creates the artifact/version/file rows, and returns the stable
authenticated detail URL. It requires `artifacts:write` and is annotated as a
bounded, non-destructive, idempotent write without open-world impact. Its safe
result contains artifact and version identifiers, version state, and the
canonical `/clubs/:clubSlug/artifacts/:id` URL. It never returns source text,
R2 keys, renderer capabilities, account identity, or internal object paths.

### `create_artifact_version`

Input:

- Owned `artifact_id`
- Bounded replacement text-file collection
- Optional permitted data origins
- Required caller-generated idempotency key

It creates a retained version and moves `current_version_id`; it does not
change gallery visibility or `gallery_version_id`. It requires
`artifacts:write`. The tool does not accept title or description fields because
version creation cannot change artifact metadata; the domain service reuses
the stored title internally while finalizing the upload.

### `share_artifact`

Input:

- Owned `artifact_id`
- Exact ready `version_id`
- Explicit confirmation

It shares that version with authenticated participants. It requires
`artifacts:publish`, carries open-world impact metadata, and is rejected unless
`confirm` is exactly `true`. The model must not infer publication consent from
artifact creation or from a request to revise an artifact. Removing or changing
gallery visibility uses the website in this first MCP milestone; a future MCP
removal tool would require the same separate publication capability.

### Model-facing artifact guidance

The essential artifact rules appear in both the server instructions and the
create/version tool descriptions so a model can act correctly without first
reading another resource. The Gardener guide provides the fuller workflow and
examples. This intentional duplication keeps the safety-critical constraints
close to every write while leaving longer educational material discoverable.

The guidance tells the model to:

- Resolve an existing project before creating an artifact; MCP creation never
  creates an inline draft project.
- Assemble the complete package before calling the tool, with root
  `index.html` and relative paths for every packaged CSS, JavaScript, image, or
  data dependency.
- Prefer self-contained CSS and JavaScript. Renderer-supported CDN dependencies
  remain constrained by the server-owned CSP and are not widened by artifact
  input.
- Use `allowed_data_origins` only for the exact HTTPS origins the artifact
  contacts through browser fetch/connect APIs. It does not grant arbitrary
  script, style, frame, form, or navigation access.
- Stay within 100 files and 2 MB of aggregate UTF-8 text, and supply only
  extension/MIME combinations supported by the HTML package validator.
- Generate a stable caller idempotency key, reuse it only for an identical
  retry, and use `create_artifact_version` for revisions rather than creating
  duplicate artifacts.
- Treat the authenticated detail URL as the canonical result. Never expose or
  invent renderer, R2, capability, or direct object URLs.
- Describe create and version results as private. Call `share_artifact` only
  after an explicit user request and confirmation.

Create/version tool results say "private artifact created" or "private version
created"; the sharing result says "version shared." Stable artifact failures
are mapped to public MCP error codes without uploaded source, provider detail,
SQL errors, stack traces, tokens, or storage identifiers.

### Deferred MCP file import

Existing binary files may later arrive through native ChatGPT file parameters
or a cross-host MCP App file picker that streams directly to the browser upload
API. That addition must not encode large binary content as model-facing MCP
arguments.

## Validation and Limits

Initial limits are deliberately below platform maxima and live as shared
constants used by website validation, the artifact service, the renderer, and
tests.

### Browser packages

- At most 500 files.
- At most 100 MB expanded per version.
- At most 25 MB per ordinary package asset.
- One data or media file may use the remaining aggregate allowance up to
  100 MB.
- HTML packages require a root `index.html`.
- Paths must be normalized relative UTF-8 paths with bounded segment and total
  lengths.

### MCP text packages

- At most 100 files.
- At most 2 MB aggregate UTF-8 content.
- The same path and package-shape rules as browser HTML packages.

### Rejected inputs

- Empty artifacts.
- Absolute paths, traversal, empty segments, control characters, or duplicate
  normalized paths.
- Symlinks and special ZIP entries.
- Hidden platform metadata such as `.DS_Store` and `__MACOSX`.
- Executables, installers, scripts masquerading as downloads, and macro-enabled
  Office files.
- File extensions or declared MIME types outside the type-specific allowlist.
- MIME/extension mismatches where signature or text decoding can verify them.
- Non-HTTPS external links and data origins in production.

HTML packages intentionally allow executable browser assets such as HTML,
CSS, JavaScript modules, Wasm, and workers because they run only inside the
renderer boundary. Download-only artifacts use a separate safe list covering
common documents, images, text/data formats, media, and source archives. Every
download is served with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`.

## Renderer and Capability Design

### Capabilities

The website issues a short-lived bearer capability only after resolving the
version the authenticated viewer may see. Its signed claims bind:

- Version ID and immutable R2 prefix.
- Entry path.
- Normalized static and data-origin policy.
- Expiry and token version.

Capabilities appear in the renderer path so relative asset URLs remain beneath
the capability namespace. They are never written to logs or analytics. The
renderer and artifact responses use `Referrer-Policy: no-referrer` and
`Cache-Control: private, no-store` so the bearer path is not leaked or retained
in shared caches.

The entry document is served only when requested as an iframe, using Fetch
Metadata headers where supported. A direct top-level request fails closed.
Assets remain available only beneath a valid unexpired capability. If a view
outlives its capability, the authenticated wrapper can issue a new one and
reload.

### Website wrappers

The detail page includes artifact metadata, project, description, current or
gallery version, version controls for the owner, declared external origins,
and a sandboxed preview.

“Open full screen” navigates to an authenticated full-viewport website wrapper
that still contains the sandboxed iframe. It never redirects to or opens the
renderer entry document directly.

### Iframe sandbox

The iframe grants only `allow-scripts`. It never grants:

- `allow-same-origin`
- Forms
- Popups
- Top-level navigation
- Downloads without an explicit website-controlled action
- Storage Access API access
- Modals, orientation lock, presentation, or pointer lock

Without `allow-same-origin`, uploaded code receives an opaque origin and cannot
read website or renderer cookies and storage. The renderer never sets
authentication cookies.

### Response security policy

The renderer builds policy from server-owned constants and normalized version
metadata. Uploaded HTML cannot supply or relax response headers.

The baseline policy:

- `default-src 'none'`
- `base-uri 'none'`
- `object-src 'none'`
- `frame-src 'none'`
- `form-action 'none'`
- `frame-ancestors https://vibegarden.club`
- Script sources: inline scripts, the renderer-hosted runtime, approved static
  dependency hosts, Wasm evaluation, and required blob workers.
- Style sources: inline styles, packaged styles, and approved style/font hosts.
- Image, font, and media sources: packaged assets, required data/blob URLs, and
  the relevant approved static hosts.
- `worker-src`: the renderer runtime and blob workers.
- `connect-src`: capability-scoped renderer assets plus the exact declared
  per-version data origins.

Additional headers include:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- A restrictive `Permissions-Policy` denying camera, microphone, geolocation,
  payment, USB, Bluetooth, sensors, and other unneeded capabilities
- Credential-free CORS on capability-scoped data assets so an opaque sandbox
  origin can load packaged data

Production and development parent origins use separate explicit policy; no
wildcard parent origin is allowed.

## Dependencies, DuckDB, and Data Access

### Static dependency allowlist

The initial global allowlist covers common static dependency delivery:

- `cdn.jsdelivr.net`
- `unpkg.com`
- `cdnjs.cloudflare.com`
- `esm.sh`
- `fonts.googleapis.com`
- `fonts.gstatic.com`

Uploaded code should pin dependency versions and use integrity metadata where
the provider supports it. Adding a host changes the trust boundary and requires
an explicit security review and tests.

### Vibe Garden-hosted DuckDB-Wasm

The renderer exposes a pinned, versioned DuckDB-Wasm runtime, Wasm binary, and
worker assets. Artifacts reference the stable platform URL rather than a
mutable third-party bundle URL. The first release uses a single-thread bundle;
a later multithreaded runtime may add cross-origin isolation only after its
effect on external assets and embeds is tested.

Packaged CSV, TSV, JSON, Parquet, and related safe data files load through the
capability path. The renderer returns credential-free CORS headers for these
assets because a sandbox without `allow-same-origin` has an opaque origin.

### External data origins

An artifact version declares exact HTTPS origins it needs for `fetch` or
DuckDB remote reads. The upload UI extracts literal URLs as suggestions, but
the owner must confirm the normalized origins. Static detection is advisory;
the response CSP is authoritative and blocks undeclared dynamically
constructed origins.

The detail and gallery pages disclose the allowed external origins before a
viewer interacts with the artifact. A remote source must also permit the
credential-free cross-origin request. When it does not, the owner should
package the bounded data file with the artifact instead.

External data remains at its origin and is not copied into Vibe Garden. This
preserves the MCP design's distinction between project-output storage and a
general dataset-ingestion path.

## User Experience

### Owned artifacts

The Artifacts page lists the participant's artifacts grouped by project. Each
item shows title, description, type, current version, visibility, and last
updated time. The primary action starts an upload or link flow.

The artifact detail page provides:

- Project and editable title/description.
- Sandboxed HTML preview or safe download/external-link action.
- Current version and retained version history.
- Restore and new-version controls.
- Private/gallery status and the exact gallery version.
- Declared external network origins.
- “Open full screen” for HTML artifacts.

### Gallery

Gallery cards show title, description, artifact type, project, participant,
and shared version without loading many live iframes. Selecting a card opens
the authenticated detail page and sandboxed preview of `gallery_version_id`.

### Other file and link artifacts

Safe file artifacts are download-only initially. Links open in a new tab with
`noopener` and `noreferrer`. Inline PDF, SVG, document, archive, or media
renderers are outside the initial boundary.

## Deletion and Retention

- Deleting an artifact sets `deleted_at` immediately and hides it from owned
  lists, gallery, MCP reads, and capability issuance.
- R2 objects and D1 metadata remain recoverable for 30 days.
- A scheduled cleanup permanently removes expired soft-deleted objects and
  metadata.
- Project deletion is rejected while the project owns live or recoverable
  artifacts. The UI directs the participant to remove or restore them first.
- Abandoned or failed upload sessions expire and their recorded R2 objects are
  removed by scheduled cleanup.
- Cleanup is idempotent and records only identifiers, counts, bytes, and
  outcomes.

## Consistency, Idempotency, and Error Handling

Browser upload sessions follow:

```text
pending -> finalizing -> complete
   |            |
   +----------> failed
   |
   +----------> aborted
```

- A file upload is idempotent for the same path and checksum.
- Reusing a path with different bytes is a conflict.
- Finalization is idempotent and returns the same created artifact/version
  after a successful retry.
- MCP mutations require a caller-generated idempotency key scoped to user,
  operation, and target.
- Version publication happens in a D1 transaction after all R2 writes and
  server-recorded manifest checks succeed.
- R2 and D1 cannot form one transaction. Objects written before a D1 failure
  stay unreachable and are reclaimed by cleanup.
- No API or renderer route serves pending or failed uploads, soft-deleted
  artifacts, unauthorized versions, or unshared versions.
- Missing and unauthorized artifacts are indistinguishable to non-owners.
- Invalid inputs return stable typed errors with actionable messages.
- D1/R2 failures return retryable service errors without infrastructure detail.
- A renderer error returns a fixed safe document; it never echoes paths,
  uploaded source, policy tokens, or stack traces.

## Authentication, CSRF, and Authorization

Website routes use the existing session identity. Every cookie-authenticated
unsafe request must pass a central exact-origin check before route logic runs.
In production, only `https://vibegarden.club` is accepted. `Origin: null`, the
renderer subdomain, missing origins where a browser origin is expected, and
all other origins fail closed.

This protection applies to existing application writes as well as artifact
routes. Enabling the renderer is blocked on an audit and tests for every
cookie-authenticated unsafe route. Host-only cookies are mandatory; code must
never set `Domain=.vibegarden.club` or a broader parent domain.

MCP routes use the approved OAuth 2.1 authorization-code-plus-PKCE design:

- `artifacts:write` creates private artifacts and versions.
- `artifacts:publish` changes gallery visibility or shared version.
- Token `userId` and selected `clubId` are authoritative; caller-supplied
  identity or club fields never establish scope.
- Project, artifact, and version queries include the authenticated owner and
  club in their predicate. Artifact and version queries derive club ownership
  by joining through their project.
- OAuth bearer routes use MCP resource, audience, issuer, expiry, signature,
  origin, and scope validation rather than website cookie-CSRF handling.
- Existing grants do not silently gain the additive artifact scopes. Clients
  must reauthorize before an artifact tool can be called.

## Observability

Structured logs may include operation, opaque request ID, one-way user-scoped
hash, artifact/version/upload IDs, counts, aggregate bytes, duration, outcome,
and stable error code.

Logs must not include uploaded content, descriptions, URLs with capability
paths, capability claims or signatures, session/OAuth tokens, email addresses,
R2 keys, external data query strings, or exception bodies containing source.

Metrics cover upload success/failure, finalization latency, bytes, cleanup,
renderer status, capability rejection reasons, CSP-relevant policy failures
where observable, and gallery actions.

## Verification

### Unit tests

- Path normalization, Unicode boundaries, traversal, duplicates, and ZIP entry
  rejection.
- Type-specific extension/MIME allowlists, decoding/signature checks, file
  counts, and byte limits.
- Manifest and aggregate checksum construction.
- Capability signing, tamper rejection, expiry, exact version/prefix binding,
  and secret separation.
- Deterministic CSP and Permissions Policy construction from normalized
  origins.
- Idempotency-key behavior and conflicting retries.
- Version numbering, restore, current/gallery pointer separation, and
  visibility transitions.
- OAuth scope and token-property parsing, exact artifact tool schemas, stable
  discovery order, mutation annotations, and safe output shapes.
- Model guidance covers package completeness, root `index.html`, relative
  assets, exact data origins, idempotency, versioning, privacy, and explicit
  sharing consent.

### Service and integration tests

- Owned project requirement and inline `seed` project creation.
- Cross-user project, artifact, version, upload, restore, deletion, and share
  attempts.
- Same-user cross-club create, version, and share attempts using an OAuth token
  bound to another selected club.
- D1/R2 success and each partial-failure ordering.
- Pending uploads never becoming readable versions.
- Failed/abandoned upload and soft-delete cleanup.
- Gallery readers receiving only `gallery_version_id` while owners receive
  `current_version_id`.
- Cookie-authenticated unsafe requests rejected from the renderer, `null`,
  missing, and unrelated origins.
- OAuth artifact write and publish scopes tested independently.
- Existing read-only grants receive an insufficient-scope challenge and must
  reauthorize for the new additive scopes.
- Exact idempotent MCP replay succeeds while reuse with changed files or
  metadata returns an idempotency conflict.
- MCP results, error responses, and structured logs omit source content,
  identities, tokens, R2 keys, capabilities, provider errors, and stack traces.

### Browser security tests

An uploaded fixture attempts each forbidden action and proves it cannot:

- Read or modify the parent DOM.
- Read website or renderer cookies, local storage, IndexedDB, or other
  same-origin storage.
- Submit forms, open popups, navigate the top level, or open its renderer entry
  directly.
- Call website mutation APIs with the participant's session.
- Fetch undeclared origins or create nested browsing contexts.
- Use camera, microphone, geolocation, clipboard, payment, USB, or other denied
  capabilities.

Positive fixtures prove:

- Packaged scripts, styles, images, fonts, and relative assets load.
- The pinned DuckDB-Wasm runtime loads.
- DuckDB reads packaged CSV and Parquet.
- An approved CORS-enabled remote CSV origin works.
- The same remote source fails when undeclared.
- Expired capabilities refresh through the authenticated wrapper.

### End-to-end tests

- Single HTML upload.
- ZIP package upload and local expansion.
- Safe downloadable file and HTTPS link artifacts.
- Existing project selection and inline `seed` project creation.
- Metadata edits, retained-version upload, restore, and stable URLs.
- Private default, explicit gallery share, pinned gallery version, gallery
  update, and gallery removal.
- Authenticated detail and full-screen wrappers.
- MCP create, version, idempotent retry, share, and insufficient-scope flows.

### Configuration assertions

- R2 has no public bucket exposure.
- Renderer routes only on `usercontent.vibegarden.club`.
- Website and renderer use separate secrets and deployments.
- Session cookies are host-only, secure, HTTP-only, and appropriately
  SameSite-restricted.
- Renderer security headers cannot be overridden by R2 object metadata or
  uploaded HTML.
- Production CSP parents name `https://vibegarden.club` exactly.

## Repository Guardrails

Implementation creates a root `AGENTS.md` with these non-negotiable rules:

- Keep app session cookies host-only; never set a parent `Domain` attribute.
- Serve renderer access through short-lived capabilities, never app cookies.
- Keep previews and full-screen views inside sandboxed iframes.
- Never add `allow-same-origin`, forms, popups, or top-level navigation.
- Require exact origin checks or CSRF protection on every cookie-authenticated
  unsafe endpoint.
- Apply renderer-owned CSP and `Referrer-Policy: no-referrer`.
- Never make the artifact R2 bucket public.
- Never serve uploaded HTML from `vibegarden.club`.
- Never open a renderer entry document directly.
- Never broaden CSP, CORS, static dependency hosts, or renderer capabilities
  without explicit security review and corresponding negative tests.
- Keep anonymous `public` visibility disabled until artifacts use a separate
  registrable renderer domain.

The file points future agents to the security fixtures and configuration tests
that must pass whenever the boundary changes.

## Infrastructure and Domain Changes

Implementation adds:

- A private R2 bucket binding to the main Worker and renderer Worker.
- A dedicated renderer Worker configuration and deployment command.
- The custom renderer route `usercontent.vibegarden.club`.
- A dedicated renderer-signing secret in both deployments.
- Scheduled cleanup for expired uploads and soft-deleted artifacts.
- Environment-specific canonical website and renderer origins.

The application domain has moved to `vibegarden.club`. Canonical URLs, OAuth
resource metadata, allowed web origins, renderer policies, and documentation
must use that domain. The repository still contains
`Vibe Garden <no-reply@vibegarden.dumky.net>` in `wrangler.jsonc`; deployment
updates it to a verified `vibegarden.club` sender only after the mail provider
and DNS are configured, so the domain migration does not silently break OTP
delivery.

## Future Public Sharing

The schema reserves `public`, but the application rejects it initially.
Before enabling anonymous public sharing:

1. Move the renderer to a separate registrable domain.
2. Decide whether public URLs are stable artifact URLs or version-pinned URLs.
3. Add abuse reporting, moderation, takedown, rate limits, and storage quotas.
4. Revisit permitted network origins and dependency policy for anonymous
   viewers.
5. Add public-safe metadata and author-display controls.
6. Re-run the renderer threat model and host security tests.

This change should require no R2 or D1 model migration beyond enabling the
reserved visibility and adding public-facing policy metadata.

## References

- *The Gardener MCP Server: Design Spec* (2026-07-18), the companion MCP
  workstream specification
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [MDN cookie security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
