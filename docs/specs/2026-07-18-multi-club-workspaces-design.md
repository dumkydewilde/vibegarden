# Multi-Club Workspaces Design

**Date:** 2026-07-18
**Status:** Conversational design approved; written-spec review pending

## Goal

Turn Vibe Garden's current single workspace into a multi-tenant application in
which one person can belong to multiple clubs. Each club has an isolated set of
participants and activity, its own path-based URL, scoped administrators, and a
dedicated platform-managed OpenRouter key.

The existing workspace and all existing data become **WOTF Club** at
`/clubs/wotf`. New clubs can be created immediately by any signed-in person and
start with access to curated free OpenRouter models only.

## Product decisions

- Clubs use path-based URLs under `/clubs/:clubSlug`.
- Identity and personal settings are global. Projects, Gardener activity,
  questionnaire answers, comments, feedback, onboarding, and administration
  are club-specific.
- A person can belong to multiple clubs and hold a different role and
  onboarding state in each one.
- Club roles are `owner`, `admin`, and `member`. The platform role is either
  `user` or `super_admin`.
- Any signed-in person can create a club and becomes its owner.
- New clubs start with the `free_only` model policy. Only a super admin can
  grant platform-funded paid-model access.
- Membership is available through an email invitation or a reusable,
  expiring invitation link. There are no public clubs or join requests.
- A club has exactly one owner. Super admins inherit effective club-admin
  access, but not owner-only transfer or archive authority.
- Version one archives clubs instead of permanently deleting them.

## Architecture

Vibe Garden continues to use one Cloudflare D1 database. Tenant isolation is
logical and explicit: every club-owned record carries a required `club_id`, and
every club-owned query includes that ID.

The server resolves a `ClubContext` once for every club route:

```ts
type ClubContext = {
  club: Club;
  membership: ClubMembership | null;
  effectiveRole: "owner" | "admin" | "member";
  isSuperAdmin: boolean;
};
```

`requireClubContext(request, slug)` authenticates the person, resolves a
canonical club or slug alias, checks membership, and calculates effective
permissions. Club data helpers accept this context, or an explicit trusted
`clubId` at lower-level boundaries. They never infer a club from the user
alone.

Collection queries always filter by `club_id`. Object lookups filter by both
object ID and `club_id`; knowing an ID from another club therefore produces a
404 instead of exposing whether the object exists.

Separate databases per club and an active-club cookie with unscoped routes were
rejected. Separate databases complicate migrations, provisioning, and global
administration. Cookie-only tenancy makes URLs ambiguous and makes accidental
cross-club access more likely.

## Data model

### Global identity

`users` retains global identity and personal preferences:

- ID, email, and display name.
- `platform_role`: `user` or `super_admin`.
- Global profile and theme settings.
- `last_club_id`, used only as a navigation preference and never as an
  authorization source.

The existing global `role`, onboarding `stage`, and model preference are
replaced by platform role and membership-specific fields.

### Clubs and memberships

`clubs` contains:

- Stable ID, display name, unique canonical slug.
- `model_policy`: `free_only` or `all_models`.
- `status`: `active` or `archived`.
- Creator and created, updated, and archived timestamps.

`club_memberships` contains:

- Club ID and user ID, unique as a pair.
- Role: `owner`, `admin`, or `member`.
- Club-specific onboarding stage and selected model.
- Joined and updated timestamps.

The service layer enforces exactly one owner per club. Ownership transfer and
the corresponding role changes happen in one transaction. The final owner
cannot leave, be removed, or be demoted before transferring ownership.

`club_slug_aliases` maps a previous unique slug to its club. Aliases never
expire automatically and cannot be claimed by another club while present.

### Invitations

`club_invitations` scopes the existing email invitation flow to a club and
stores the normalized email, status, inviting administrator, and timestamps.
An existing account receives membership immediately; otherwise the invitation
authorizes sign-in and creates membership after the email is verified.

`club_invite_links` contains:

- Club ID, unique token hash, creator, and creation timestamp.
- Expiry selected from 1 hour, 24 hours, 7 days, or 30 days.
- Optional maximum join count and current successful join count.
- Optional revocation timestamp.

Only the generated URL contains the raw cryptographically random token. The
database stores its secure hash. Existing members do not consume another use.
Validation and membership creation are atomic so two people cannot consume the
final available slot.

### Club-owned activity

Required `club_id` references are added to:

- `projects`
- `chat_threads`
- `questionnaire_responses`
- `comments`
- `site_feedback`
- Existing invitation records

Chat messages inherit their tenant from their thread and are not independently
addressable without resolving that thread. Future artifacts, gallery entries,
and participant activity follow the same ownership rule.

An `audit_events` table records sensitive administrative actions with the
actor, club, action, target type and ID, timestamp, and non-secret metadata.
It covers ownership transfers, role changes, removals, invitation revocation,
key rotation, policy changes, and club archival or restoration.

### OpenRouter credentials

`club_ai_credentials` stores one platform-managed credential record per club:

- Club ID, key hash, display suffix, and remote workspace/guardrail IDs.
- AES-GCM ciphertext, initialization vector, and encryption-key version.
- Provisioning state such as `pending`, `ready`, `failed`, or `disabled`.
- Last attempt, last successful synchronization, and sanitized error metadata.

The management key and encryption key remain Worker secrets. Raw OpenRouter
keys, raw invitation tokens, chat content, and questionnaire answers never
appear in logs or audit metadata.

## Routes and navigation

All club experiences move below the canonical club slug:

```text
/clubs/:clubSlug
/clubs/:clubSlug/garden
/clubs/:clubSlug/garden/projects/:id
/clubs/:clubSlug/learning
/clubs/:clubSlug/artifacts
/clubs/:clubSlug/gallery
/clubs/:clubSlug/inspiration
/clubs/:clubSlug/admin
/clubs/:clubSlug/admin/conversations/:id
/clubs/:clubSlug/admin/settings
```

Club-sensitive resource and API routes are scoped the same way, including
`/clubs/:clubSlug/api/chat`. Page loads, mutations, streaming requests, and
bookmarks therefore carry explicit tenant context.

Global routes remain outside clubs:

```text
/
/login and /auth/...
/settings
/join/:token
/admin/clubs
```

After sign-in, `/` redirects to the last-used accessible club. Without history,
it opens the person's only club or shows their club list. A person with no clubs
goes to `/settings`, which presents club creation.

Selecting a club in the switcher navigates to that club's home and updates
`last_club_id`; it does not try to preserve an arbitrary nested page. Changing
a slug writes an alias, and old URLs redirect to the current canonical URL
while preserving the remaining path and query string.

Unauthorized and unknown club URLs return 404. Archived clubs reject normal
member access. A super admin can open any active club with effective admin
access.

## Interface

The existing sidebar keeps **Vibe Garden** as its primary label. A compact
club-name dropdown immediately below it shows the current club:

```text
Vibe Garden
WOTF Club ▾
```

The dropdown lists accessible clubs with the current one marked, followed by
**Create club** and **Manage clubs**. Mobile navigation provides the same
control near the top of its navigation sheet.

Global `/settings` contains editable personal details, the person's clubs and
role in each, links to open those clubs, and club creation. Members and admins
can leave a club. Owners instead see guidance to transfer ownership first.

Club creation asks for a display name, proposes an editable normalized slug,
creates the owner membership, applies `free_only`, and redirects to the new
club. Reserved, malformed, aliased, or already-used slugs are rejected.

Club administration contains focused sections:

- **Overview:** club details and activity summary.
- **Members:** member removal plus owner-only admin role changes and ownership
  transfer.
- **Invitations:** email invitations and reusable link creation, usage, and
  revocation.
- **Settings:** owner-only name and slug controls, plus read-only AI status for
  club administrators.

Global `/admin/clubs` is available only to super admins. It lists name, owner,
member count, club status, model policy, AI provisioning state, and spending
cap. It provides entry into a club as an effective admin and platform controls
for policy, retry, rotation, disabling, archival, and restoration.

Onboarding is independent per membership. Switching to a club whose onboarding
is incomplete opens that club's welcome flow; returning to another club
restores its existing state.

The interface includes explicit states and next actions for no memberships,
AI provisioning, failed provisioning, archived clubs, unavailable invitations,
and failed club creation. Desktop and mobile controls preserve keyboard access,
focus behavior, and textual role/status labels.

## Membership and permissions

Owners can manage club identity, slug, members, administrators, invitations,
ownership transfer, and archival. Owners also have all admin and member
permissions.

Admins can invite and remove `member`-role participants, manage reusable links,
moderate club content, review feedback and Gardener conversations, and use the
existing admin tools. They cannot promote or demote administrators, remove an
owner or administrator, transfer ownership, archive the club, or control
platform-managed AI credentials and model policy.

Members use the participant experience. A user can hold independent roles in
different clubs.

Super admins bypass membership checks for active clubs and receive effective
`admin` access when they have no explicit membership. An explicit membership,
including WOTF ownership, takes precedence. Super admins do not implicitly
become members, do not acquire owner rights, and do not appear in club member
counts unless explicitly added. They alone control platform-funded model
policies, spending caps, guardrails, keys, and restoration of archived clubs.

Removing a member does not delete the global account or affect other clubs.
Their former club data remains visible to authorized club administrators but
is no longer accessible to that person.

## Invitation flow

Reusable links use `/join/:token`, independent of the club slug. A GET displays
the club name and an explicit **Join club** action; it never creates membership.
An anonymous visitor signs in and then returns to the invitation.

The membership mutation verifies the token hash, expiry, revocation state, and
remaining capacity, then creates membership and increments usage atomically.
Duplicate joins are idempotent. Expired, revoked, exhausted, malformed, and
otherwise unavailable tokens show the same neutral message without revealing
club membership details.

## OpenRouter provisioning and enforcement

Every club receives a dedicated OpenRouter key created through the Management
API. Club creation commits the club and owner membership first, marks AI
provisioning `pending`, and starts provisioning. The club remains usable if
OpenRouter is unavailable.

Provisioning is idempotent and uses the stable club ID as the remote key name:

1. Reconcile any existing remote key created by an earlier attempt.
2. Create the key with `POST /api/v1/keys` when none exists.
3. Immediately encrypt the one-time plaintext key with AES-GCM.
4. Store ciphertext and non-secret remote metadata.
5. Create or reuse the appropriate guardrail.
6. Assign the key hash to that guardrail.
7. Mark AI access `ready` only after the assignment is confirmed.

OpenRouter's Management API returns the plaintext key only during creation and
supports per-key spending limits and reset intervals. Guardrails support model
allowlists and direct assignment to a key; a key can have at most one directly
assigned guardrail. See the official references for
[key creation](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys),
[guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview),
and [key assignment](https://openrouter.ai/docs/api/api-reference/guardrails/bulk-assign-keys-to-guardrail).

Self-created clubs receive:

- `free_only` application policy.
- An explicit curated allowlist of model IDs ending in `:free`.
- A shared free-only guardrail assigned directly to the club's key.
- A zero-dollar key spending limit as defense in depth. The allowlist remains
  the authoritative paid-model restriction.

WOTF receives `all_models`, its own key and guardrail, and the application's
curated free and paid model list. It initially preserves current unlimited
behavior. A super admin can later set a daily, weekly, or monthly cap.

The model picker receives only models allowed by the current club. The chat
endpoint validates the requested model against the same policy before
decrypting the club credential. A disallowed or stale saved preference falls
back to the club default.

Policy changes update application state and the remote guardrail. A downgrade
to `free_only` is not considered complete until the stricter remote guardrail
is confirmed; chat is unavailable during unresolved policy drift. Rotation
creates and verifies the replacement before disabling the old key.

While initial provisioning is pending or failed, the Gardener displays **The
Gardener is still being set up** with a retry path for the super admin. Club
owners can see availability but cannot view, export, rotate, or replace the
credential. Club-supplied OpenRouter keys are outside version one.

## Lifecycle and failures

- Club creation validates the slug, creates club and owner membership in one
  transaction, records the last-used club, and then starts AI provisioning.
- Ownership transfer changes both membership roles transactionally and records
  an audit event.
- Archiving rejects normal access, prevents chat calls, and disables the
  platform-managed OpenRouter key. A super admin can restore the club.
- Switching clubs is navigation only; every destination revalidates access.
- If the last-used club becomes inaccessible, `/` chooses another membership
  or sends the person to `/settings`.
- API authorization failures use structured 401, 403, or 404 responses. UI
  routes generally use 404 to avoid exposing private club existence.
- OpenRouter requests include no fallback to another club's key. Provisioning
  and policy errors fail closed for AI while leaving non-AI club features
  available.

## Migration and rollout

The existing deployment becomes WOTF without losing data or immediately
breaking old links.

The migration creates WOTF with slug `wotf` and `all_models`, promotes the
configured current admin account to `super_admin`, and makes that account the
WOTF owner. Every existing user receives a WOTF membership. Existing onboarding
stage and model preference move to that membership. All current club-owned
records and invitations are assigned to WOTF.

Rollout uses an expand/backfill/contract sequence:

1. Back up D1. Add club tables, credential metadata, indexes, and initially
   nullable `club_id` columns.
2. Create WOTF and idempotently backfill memberships and all owned records.
3. Verify row counts, referential integrity, owner count, and membership
   coverage.
4. Deploy club-aware routes and query helpers.
5. Redirect legacy `/garden`, `/admin`, and other workspace paths to their
   `/clubs/wotf/...` equivalents while preserving query strings.
6. Provision WOTF's dedicated key. The existing platform key is available only
   as a temporary WOTF migration fallback and is removed after verification.
7. Enforce required club references and remove temporary compatibility code in
   the contract phase.

Backfill statements and provisioning attempts are idempotent. If deployment is
interrupted, the sequence can safely resume. Rollback restores the previous
application deployment and the pre-migration D1 backup; it does not attempt to
reverse new multi-club activity after the feature has opened to users.

## Testing and operations

Automated tests prioritize the tenant boundary:

- Club resolution for members, non-members, aliases, super admins, and archived
  clubs.
- Cross-club object IDs returning 404 for projects, conversations, comments,
  feedback, invitations, and admin views.
- Independent roles, onboarding, questionnaires, and model preferences for one
  person across multiple clubs.
- Owner invariants and transactional ownership transfer.
- Invite-link expiry, revocation, limits, duplicate joins, and concurrent final
  slot use.
- Slug validation, uniqueness, reserved names, and canonical redirects.
- Model-policy enforcement in both model discovery and the chat endpoint.
- Provisioning, idempotent retry, rotation, downgrade, disable, archival, and
  encrypted credential handling.
- Migration row counts, WOTF backfills, and compatibility redirects.
- Desktop and mobile switcher behavior and settings permissions.

Unit and integration tests use a mocked OpenRouter management client. A staging
smoke test creates a real key, assigns the free-only guardrail, performs one
free-model request, checks policy rejection, and cleans up the key. It also
confirms that a zero-dollar limit permits allowlisted free-model traffic before
that setting is enabled in production.

Structured logs include club ID, request ID, operation, and provisioning state,
but exclude secrets and private content. A scheduled reconciliation task lists
platform-managed remote keys and assignments, repairs safe metadata drift, and
flags orphaned or duplicate credentials for super-admin review. The global
clubs dashboard surfaces provisioning failures and policy-sync drift.

## Non-goals

- Subdomains, custom domains, or active-club cookies as the tenancy mechanism.
- Public club discovery, public enrollment, join requests, or email-domain
  auto-enrollment.
- Single-use links or arbitrary custom invitation expiry dates.
- Separate D1 databases per club.
- Club-owned or bring-your-own OpenRouter accounts and keys.
- Club-level billing or subscription management.
- Permanent club deletion.
- Preserving the equivalent nested page when switching clubs.
