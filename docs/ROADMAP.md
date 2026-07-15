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
- [ ] Production email: set RESEND_API_KEY (until then the login screen
      shows the code inline)
- [ ] Production D1: `wrangler d1 create vibe-garden`, put the id in
      wrangler.jsonc, `npm run db:migrate:prod`, `wrangler secret put SESSION_SECRET`

## Phase 3: The Gardener (agent) (done, 2026-07-14)

- [x] Streaming chat endpoint via OpenRouter (default Kimi K2.6; also
      DeepSeek V4 Flash, Qwen3.7 Plus, Gemma 4 26B free)
- [x] Model picker wired to real models, per-user preference saved on chat
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
- [x] `fresh_reads` tool: read-only MotherDuck share (Dumky's RSS feed
      summaries, score >= 3, news/opinion/tutorial) via the PG endpoint and
      the `pg` driver. Activates when MOTHERDUCK_TOKEN is set (use a
      read-scaling token)
- [ ] Data analysis, workshop-native: DuckDB-WASM in the browser. The
      Gardener writes SQL, the participant's browser runs it against their
      uploaded CSV, results return to the chat. No server compute, data
      stays on their machine
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
- [ ] Later ideas: prompting basics, cost and budgets, publishing/deploying
      your project, privacy and personal data

## Phase 6: Polish, deploy, invite

- [ ] Production deploy via wrangler, custom domain
- [ ] Design pass against the original mockup
- [ ] Invite the first friends

## Later / ideas

- Gardener as MCP server (continue projects in Claude Code/Codex)
- Free-tier model option for participants without a budget
