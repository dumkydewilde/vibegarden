# MCP project writes (create_project, update_project)

Date: 2026-08-11. Tier: medium (one feature in an existing surface).
Spec context: `docs/specs/2026-07-18-gardener-mcp-server-design.md` already
reserves `projects:write` as "create or update projects, but not delete them".
This plan cashes that in.

## Goal

Someone working in their own Claude or ChatGPT can plant a project in Vibe
Garden and keep it up to date from there, so what they build with their own
assistant shows up in the club instead of staying in a private chat.

## Decisions

- **New scope `projects:write`**, additive. Existing connections must
  reauthorize to gain it. No delete tool and no delete scope: deletion stays a
  web-only, explicitly destructive action (spec's rule).
- **Two tools**, both non-destructive writes:
  - `create_project(title, one_liner?, notes?, building_blocks?, idempotency_key)`
  - `update_project(project_id, title?, one_liner?, notes?, building_blocks?, status?)`
    with at least one changed field required.
- **New `projects.notes` column** (4,000 chars). This is the "content" a
  project has been missing: `one_liner` is a 300-char headline, and there was
  nowhere for an assistant to write up what was actually built, decided, or
  tried. Notes are editable on the project page too, so the web and MCP
  surfaces stay symmetric, and they feed the "Discuss with The Gardener"
  context and project search.
- **Idempotent create** via `projects.mcp_idempotency_key` plus a unique index
  on `(user_id, club_id, mcp_idempotency_key)`. Reusing a key returns the
  project the first call created rather than planting a duplicate. Rows created
  in the web UI keep a NULL key, and SQLite treats NULLs as distinct, so the
  index costs nothing there. No fingerprint column: a replay returns the
  original project unchanged, which the tool description states plainly.
- **`building_blocks` accepts a module slug or its display title**, resolved to
  the stored display title, and returns `invalid_input` naming the unknown
  value. The web form silently drops unknown names; a tool caller deserves to
  be told.
- Field bounds live in `app/lib/project-limits.ts` so the forms, the MCP
  contracts, and the D1 writes cannot drift. Statuses come from
  `PROJECT_STATUSES` in `app/lib/project-status.ts`.
- MCP validates and rejects over-long fields instead of silently truncating,
  unlike the forms, which truncate.

## Work

1. `drizzle/0009_project_notes.sql` (hand-written, matching the recent
   convention) plus the Drizzle schema: `notes`, `mcp_idempotency_key`, unique
   index.
2. `app/lib/project-limits.ts`, `PROJECT_STATUSES`, `resolveModuleName` in
   `app/lib/modules.ts`.
3. `app/lib/projects.server.ts`: notes on create and update, idempotent create,
   notes included in owned-project search.
4. MCP: scope, tool order, contracts, presenter `notes`, two tool
   registrations, instructions and `content/gardener/mcp-guide.md` guidance.
5. Web parity: notes field on the project page, notes in the Gardener context.
6. Public docs: `/connect` scope list, `/privacy/mcp` field list, consent
   screen scope label.
7. Tests: tool discovery and annotations, presenter, a real-worker
   `test/mcp/projects.test.ts` (create, replay, update, cross-club isolation,
   scope challenge, invalid input), public-doc and OAuth metadata assertions.
8. `docs/ROADMAP.md` and the spec's scope table.
