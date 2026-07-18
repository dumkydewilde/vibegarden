# Vibe Garden Roadmap

Tracking convention: this file is the single source of truth for progress.
Check items off as they land. One section per building block. Details live in
`docs/plans/`, decisions in `docs/adr/`, the spec in `docs/specs/`.

## Phase 1: UI framework (done, 2026-07-14)

- [x] Scaffold React Router 7 (framework mode) on Cloudflare Workers
- [x] Design system: Tufte-garden theme, Merriweather/Roboto, light + dark
- [x] App shell: responsive left nav, page header
- [x] Gardener sidebar (static UI): chat shell, context chips, model picker
- [x] MDX learning pipeline + 3 sample articles, paragraph-level ask
- [x] Section pages: home, garden, artifacts, gallery, inspiration, admin, join
- [x] Build, typecheck, tests green; browser pass mobile + desktop, light + dark

## Phase 2: Auth, invites, admin (done, 2026-07-14)

- [x] D1 schema (Drizzle): users, invites, sessions, otp_codes
- [x] Email OTP login for invited addresses (dev mode: code shown in UI)
- [x] Google OAuth alternative (code complete; activates when
      GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET secrets are set, untested against
      real Google credentials)
- [x] Admin: invite management, participant overview
- [x] Route guards: everything requires login except /login and /join;
      admin routes 404 for non-admins
- [x] Production email: RESEND_API_KEY set (2026-07-15)
- [x] Production D1: created, id in wrangler.jsonc, migrated, SESSION_SECRET
      set (2026-07-15)

## Phase 3: The Gardener (agent) (done, 2026-07-14)

- [x] Streaming chat endpoint via OpenRouter (default Kimi K2.6; also
      DeepSeek V4 Flash, Qwen3.7 Plus, Gemma 4 26B free)
- [x] Model picker wired to real models, per-user preference saved on chat
- [x] MiniMax M3 and DeepSeek V4 Pro added to the menu (2026-07-16) and
      MiniMax M3 made the default (~6x faster TTFT, ~4x cheaper than Kimi
      K2.6 with equal tool grounding), plus a benchmark harness:
      `scripts/benchmark-models.mjs` replays production-shaped Gardener turns
      against OpenRouter, `scripts/build-model-report.mjs` renders
      `docs/benchmarks/model-comparison.html` from the results
- [x] Context injection: article "Discuss" button, paragraph-level ask,
      article index in system prompt
- [x] Chat persistence: threads/messages in D1, history loads on sign-in,
      "new conversation" keeps the old thread
- [x] Article content loads server-side on demand via the `read_article`
      tool (see Gardener tools); Gardener as MCP server stays under Later

## Gardener tools (decided 2026-07-14, build alongside phases 4-5)

Core landed 2026-07-14, see `docs/plans/2026-07-14-gardener-tools.md`.

- [x] Web access toggle: OpenRouter web plugin (plugins param), globe toggle
      in the composer, off by default (costs per search)
- [x] Tool-calling loop in api/chat (Kimi/DeepSeek/Qwen support tools;
      free Gemma does not: the tools param is omitted, chat still works)
- [x] First-party tools: `read_article(slug)` (full text on demand),
      `read_module(slug)` (module know-how, see below), `fetch_page(url)`
- [x] Module know-how as content: `content/modules/*.mdx` (what it is, when
      to use it, setup steps, options and costs). Feeds the module drill-down
      pages at /garden/modules AND the Gardener's `read_module` tool
- [x] Building blocks expanded from the articles (2026-07-15): 7 new blocks
      (voice notes, spoken voice, image maker, knowledge assistant, database,
      web app, scheduled task), 14 total, grouped by `category` frontmatter
      on /garden and in the plant dialog. Blocks join the Gardener context
      as a first-class "module" kind: speech-bubble button on each /garden
      card plus the existing button on drill-down pages
- [x] `fresh_reads` tool: read-only MotherDuck share (Dumky's RSS feed
      summaries, score >= 3, news/opinion/tutorial) via the PG endpoint and
      the `pg` driver. Activates when MOTHERDUCK_TOKEN is set (use a
      read-scaling token)
- [x] Data analysis, workshop-native: DuckDB-WASM in the browser
      (2026-07-15). A tools menu (wrench) in the composer attaches a data
      file or link (CSV/JSON/Parquet/Excel); the browser registers it as a
      DuckDB view and introspects the schema, which rides along as a
      dataset chip and system-prompt block. The Gardener's `query_data(sql,
      chart?)` tool ends the turn as a `[[tool:query:...]]` marker; the
      browser runs the SQL, renders a table plus optional minimal chart
      (line/scatter/bar), and fires a hidden continuation carrying a capped
      result (50 rows) so the model narrates the numbers in the same
      bubble. Data never leaves the machine; server compute is zero.
      Successful continuations withhold `query_data` so the model narrates
      instead of re-querying; errors re-offer it for self-repair. Capped
      results persist on the assistant message and re-render on reload.
      An attached dataset shows as a context quote above the composer and
      moves into the chat with the sent message (removable from the tools
      menu); datasets are scoped to the conversation. Charts follow the
      shadcn style (transparent, smooth line, dashed gridlines, no axis
      lines, gap-spaced x labels that never overlap); the sidebar defaults
      wider (480px) for tables, which scroll horizontally with a sticky
      header. Data-file links pasted into the message are auto-attached and
      stripped from the text (so the model queries rather than fetches the
      raw file). Guardrails keep the answer clean: Mermaid data charts
      (xychart/line/bar/pie) are rejected so data is never charted twice;
      a successful continuation is text-only (no tools) so the model
      narrates instead of re-querying or wandering into unrelated reads;
      and parroted tool-echo fragments are stripped from the narration
- [x] Model-initiated data attachment: `attach_data(url)` tool (2026-07-16).
      When the Gardener discovers a data URL itself (a fetched page, a
      dataset briefing's sample URL, or one the person mentions without
      pasting a recognizable data link), it can attach it: the call becomes
      a `[[tool:attach:...]]` marker that ends the turn, the browser
      fetches the URL and registers it as a DuckDB view (same
      `registerDataset` path as user attaches, CORS rules apply), and an
      attach envelope (`kind: "attach"`, schema summary + row count) rides
      a hidden continuation back so the model can immediately query with
      `query_data`. Attach continuations keep tools (unlike successful
      query ones); dedupe by sourceUrl and the 5-dataset cap return
      friendly error envelopes; the chat shows a small database chip
      ("attached forecast, 24 rows" or the failure). Keeps the invariant
      that data only ever loads in the participant's browser; the server
      still only sees markers and capped envelopes.
- [ ] MotherDuck MCP for shared/persistent datasets across participants.
      Note: MotherDuck supports agent-created accounts that a user can later
      claim by POSTing to new.motherduck.com, so the Gardener can provision
      a database mid-brainstorm and hand it over
- [ ] Same milestone: expose the Gardener as an MCP server so participants
      can continue their project in Claude Code/Codex

## Phase 4: Idea Garden + progressive flow (done, 2026-07-14)

- [x] Pre-workshop questionnaire at /welcome (one question per step,
      conditional budget step, answers in D1)
- [x] Stage gating: invited users land on /welcome, completing it unlocks
      the garden (admins bypass); admin panel shows a one-line answer summary
- [x] Projects: plant from a conversation transcript or manually, cards
      with stage (Seed/Growing/Bloomed) and building blocks, detail page
      with edit and delete, linked back to the source conversation
- [x] Gardener brainstorms now end by pointing at "Plant as a project"
- [ ] Later: personalized starter cards on home based on questionnaire
      answers (e.g. budget-aware model suggestions)

## Phase 5: Artifacts, gallery, inspiration

- [ ] Uploads to R2, artifact records in D1
- [ ] Gallery visibility controls
- [x] Inspiration: first real curated set (2026-07-14): datasets incl.
      Goodreads export + TalkData, data stories (Pudding, football analysis),
      tools people built (Dot Collector, Clay-replacement post, FlickFlock,
      SelectFrom), cards link out
- [x] Inspiration datasets, agent-aware (2026-07-16): each dataset card
      carries a pre-researched `briefing` (concrete structure, how to grab a
      bounded slice, gotchas, a first question) so "Ask Gardener" no longer
      makes the model fetch the docs page. `buildDatasetContext` now tells the
      Gardener to rely on the briefing and to offer in-browser DuckDB analysis
      (attach the file, query with SQL, chart) instead of pointing at Excel.
      The full dataset catalog is injected into the system prompt via a new
      `{{DATASETS}}` placeholder, so the Gardener can suggest a fitting source
      during any brainstorm.
- [ ] Inspiration: move curated cards to content files (content-managed)

## Content (ongoing)

- [x] Batch 1 (2026-07-14): 8 new learning articles. Foundations: tokens/
      embeddings/latent space, choosing a model. Building (new category):
      component libraries, generating images, working with voice, building
      a game, agent frameworks. Working with data: extracting meaning from
      text (NER, topics, sentiment)
- [x] Batch 2 (2026-07-15): 3 new articles. Foundations: what is an API /
      what is MCP, key figures in AI (people to follow + foundational
      names). Building: automate and schedule things (cron, GitHub
      Actions). Cross-linked from "What is an agent?" and "Agent frameworks"
- [x] Batch 3 (2026-07-15): "Choosing a model" got a July 2026 model
      snapshot table (OpenRouter pricing) and a "What makes a model good"
      section; new Foundations article "Creating the right context"
      (markdown knowledge folders, progressive loading, Mermaid).
      Mermaid code fences in articles/modules now render as real diagrams
      (client-only lazy chunk, theme-aware; worker bundle untouched)
- [x] The Gardener can call `visualize_flow` to return a durable Mermaid
      preview in chat; selecting the preview opens a large accessible dialog
- [x] Audience section (2026-07-15): `content/gardener/audience.md` feeds
      the friends' shared interests (EA, sociology, basic income,
      philosophy, sustainability, entrepreneurship) into the system prompt
      via `{{AUDIENCE}}`, with rules to use them subtly; toggle with
      `enabled: false` frontmatter or by deleting the file
- [x] Batch 4 (2026-07-15): "Storing your data" got a hosted-database field
      guide table (Supabase, Neon, Convex, PlanetScale, Cloudflare D1,
      MotherDuck, PocketBase) and a "database becomes a backend" (BaaS)
      section; new Building article "Hosting your app" (static vs dynamic,
      field guide table: GitHub Pages, Cloudflare, Vercel, Netlify,
      Fly.io/Railway, Hetzner), cross-linked both ways
- [ ] Later ideas: prompting basics, cost and budgets, privacy and
      personal data

## Comments & discussion (P1-P3 done, 2026-07-15)

Feedback loop for the workshop. Plan in
`docs/plans/2026-07-15-comments-discussion.md`. Two shapes: participant-visible
discussion attached to a target, and private site feedback to the admin.
Migration `0005_misty_havok.sql` adds `comments` + `site_feedback`.

- [x] P1: article comments (`comments` table, `learning.$slug.tsx` thread,
      post / delete-own / admin-delete, chronological, flat with a reserved
      `parent_id` for future replies)
- [x] P2: inspiration card comments (stable id via `slugify(title)`, thread in
      a per-card dialog; enabled on every card, not just datasets)
- [x] P3: private site feedback to the admin (`site_feedback` table,
      `/api/feedback` resource route, dialog in the nav capturing the current
      path, admin review section with new/read/resolved)
- [ ] Later: artifact comments (once Phase 5 uploads + detail pages exist;
      `comments` already reserves `target_type = "artifact"`)

## Phase 6: Polish, deploy, invite

- [x] Article links polish (2026-07-15): internal article/module links in
      MDX render as the same inline cards as in chat (shared ContentLink),
      external links open in a new tab with an outlink icon; missing
      external links added (key figures, tools). Chat no longer breaks on
      navigation: MDX links go through the router and GardenerProvider is
      no longer remounted when the active thread id changes
- [x] Production deploy via wrangler, custom domain (2026-07-15)
- [ ] Design pass against the original mockup
- [ ] Invite the first friends

## Multi-club workspaces

Implementation ready, production rollout pending. The local test, D1, type,
and build gates pass. Production D1 migration, deployment, OpenRouter
provisioning, WOTF fallback removal, and the contract migration all require
explicit authorization for their named environment or workspace. See
[the rollout runbook](runbooks/multi-club-rollout.md).

- [x] Club-scoped routes, permissions, invitations, data access, and UI
- [x] Club-managed OpenRouter credentials, guardrails, encrypted storage, and
      hourly reconciliation
- [x] Expand migration, idempotent WOTF backfill, invariant verification, and
      local migration-history coverage
- [ ] Approved production expand, backfill, deploy, and provider smoke test
- [ ] WOTF credential ready and legacy-key fallback removed
- [ ] Contract migration after stable production verification

## Later / ideas

- Gardener as MCP server (continue projects in Claude Code/Codex)
- Free-tier model option for participants without a budget
