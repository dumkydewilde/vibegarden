# Vibe Garden Roadmap

Tracking convention: this file is the single source of truth for progress.
Check items off as they land. One section per building block. Details live in
`docs/plans/`, decisions in `docs/adr/`, the spec in `docs/specs/`.

## Phase 1: UI framework (in progress)

- [x] Scaffold React Router 7 (framework mode) on Cloudflare Workers
- [ ] Design system: Tufte-garden theme, Merriweather/Roboto, light + dark
- [ ] App shell: responsive left nav, page header
- [ ] Gardener sidebar (static UI): chat shell, context chips, model picker
- [ ] MDX learning pipeline + 3 sample articles, paragraph-level ask stub
- [ ] Section pages: home, garden, artifacts, gallery, inspiration, admin, join
- [ ] Build, typecheck, tests green; browser pass mobile + desktop

## Phase 2: Auth, invites, admin

- [ ] D1 schema (Drizzle): users, invites, sessions, otp_codes
- [ ] Email OTP login for invited addresses (dev mode: log code)
- [ ] Google OAuth alternative
- [ ] Admin: invite management, participant overview

## Phase 3: The Gardener (agent)

- [ ] Streaming chat endpoint via OpenRouter (default Kimi K2.6)
- [ ] Model picker wired to real models, per-user preference
- [ ] Context injection: current page, article skills, paragraph-level ask
- [ ] Chat persistence (threads/messages in D1)

## Phase 4: Idea Garden + progressive flow

- [ ] Pre-workshop questionnaire (interactive)
- [ ] Stage gating: invited -> questionnaire -> exploring
- [ ] Starter cards (curated article sets + brainstorm CTA)
- [ ] Projects: create via brainstorm, modules, status

## Phase 5: Artifacts, gallery, inspiration

- [ ] Uploads to R2, artifact records in D1
- [ ] Gallery visibility controls
- [ ] Inspiration: curated datasets and stories (content-managed)

## Phase 6: Polish, deploy, invite

- [ ] Production deploy via wrangler, custom domain
- [ ] Design pass against the original mockup
- [ ] Invite the first friends

## Later / ideas

- Gardener as MCP server (continue projects in Claude Code/Codex)
- Free-tier model option for participants without a budget
