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
- [ ] Later: markdown-linked article suggestions could auto-load raw article
      content server-side (tool use); Gardener as MCP server

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
