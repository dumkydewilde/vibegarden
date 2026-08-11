# MCP build guidance (learning and building blocks)

Date: 2026-08-11. Tier: medium (one feature in an existing surface).
Status: done. Companion to `docs/plans/2026-08-11-mcp-project-writes.md`, which
owns project writes and landed first.

## Goal

Someone building in Claude Code or ChatGPT should be able to ask "how do I host
this data?", "where do the images live?", "how do I call that API?", "how do I
work with the coding agent itself?" and get Vibe Garden's own material back,
not a generic answer. The content is already reachable over MCP
(`list_learning_content`, `read_article`, `read_module`), but the host has to
know to go looking and then spend two or three calls before it has anything
substantive.

## Decisions

- **One new tool, `get_guidance(question, kind?, max_items?)`**, scope
  `content:read`, read-only. It ranks all articles and modules against the
  question and returns up to three matches with real excerpts plus a `related`
  list of near misses to drill into. One call is enough to answer well, which
  is the whole point: a keyword `list_learning_content` call followed by
  `read_article` is what hosts skip today.
- **Ranking is a pure function** in `content-presenter.ts`: weighted title,
  description, category, and body term hits with a phrase bonus, so it is
  testable without a server. No embeddings, no index, no new dependency: the
  library is ~30 build-time files.
- **Excerpts are targeted, not leading**: the lead-in plus the best-matching
  `##` sections, capped well under `BODY_MAX_CHARS`. A question about hosting
  assets should get the hosting-assets section, not the article's introduction.
- **Empty result falls back to a category overview** rather than nothing, so
  the host always has a next pointer.
- **New resource `vibegarden://guide/library`**: the whole library grouped by
  category as markdown, for hosts that surface resources and for cheap
  browsing. Resource templates stay non-listable, unchanged.
  `scopeForResource` in `workers/mcp.ts` moves from the exact
  `vibegarden://guide/gardener` match to a `vibegarden://guide/` prefix.
- **New prompt `plan_build(goal)`**: embeds the Gardener guide plus the matched
  content and asks for the smallest next step, which building blocks to use,
  and one question. `continue_project` is untouched. This forces per-prompt
  routing in the `workers/mcp.ts` preflight, which currently hardcodes
  `continue_project`'s schema and `projects:read` for every `prompts/get`.
- **Server instructions and `content/gardener/mcp-guide.md`** gain a short
  "getting practical guidance" section, so hosts reach for the library on
  how-to questions instead of answering from their own memory.
- **No new scope.** Everything here is `content:read`, which existing
  connections already hold, so no reauthorization.

## Content gaps, filled alongside

Better plumbing cannot surface material that does not exist. Three of the four
questions this work is meant to answer had no home, so they were written:
"Vibe coding: how to work with a coding agent", "Where your files and images
live" (buckets, public versus signed URLs, the signed-upload pattern), and
"Calling an API for real" (keys, status codes, `429` and backoff). Two blocks
came with them, File and image store and API connection, so a project can name
them. Cross-links were added from the four existing articles that should lead
there.

## What landed

1. `contracts.ts`: `guidanceInput`, `guidanceOutput`, `planBuildPromptInput`,
   and `get_guidance` in `MCP_TOOL_ORDER` after `read_module`.
2. `content-presenter.ts`: `libraryItems` as the one shared source,
   `presentGuidance`, `presentLibraryGuide`.
3. `server.server.ts`: the tool, the `vibegarden://guide/library` resource, the
   `plan_build` prompt, and one sentence in `MCP_INSTRUCTIONS` sending how-to
   questions to `get_guidance` first.
4. `workers/mcp.ts`: preflight entry for `get_guidance`, a `promptRequirements`
   table so each prompt carries its own schema and scope, and a
   `vibegarden://guide/` prefix in `scopeForResource`.
5. `content/gardener/mcp-guide.md`: a "Getting practical guidance" section.
6. Public docs: `/connect`, `/privacy/mcp`, `docs/ROADMAP.md`, and the release
   checklist's discovery order, local rows, and both hosts' rows.
7. Tests: `guidance-presenter.test.ts` (17 cases: ranking, stemming, excerpt
   targeting, bounds, fallback, clamping, library grouping),
   `guidance-tools.test.ts` (discovery metadata, dispatch, no-match message,
   scope challenge, library resource, `plan_build`), and two real-worker cases
   in `test/mcp/worker.test.ts`.

## Notes for next time

Ranking needed two corrections that plain term counting got wrong. Rarity
weighting across the searched texts, because "what do I do when an API returns
429?" is otherwise dominated by "api", and damped hit counts, because a section
that says "API" eight times was outranking the one section that answers the
question. Both live in `needleWeights` and `proseHits`.
