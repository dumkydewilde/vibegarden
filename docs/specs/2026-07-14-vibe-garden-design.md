# Vibe Garden — Design Spec

**Date:** 2026-07-14
**Status:** Approved assumptions stated inline; built autonomously, review welcome.

## What it is

A browser-based workshop environment for 10-15 friends learning to build with AI/LLMs this summer. Choose-your-own-adventure: learning articles, an agent helper ("The Gardener"), a project space ("Idea Garden"), artifacts, a gallery, inspiration, and an admin panel for the host. Works on Windows/macOS laptops, phones, and tablets.

## Sections

| Section | Purpose |
|---|---|
| Idea Garden | Start/manage your project; brainstorm with the agent; combine modules (CSV, Google Sheet, photos/scans, dashboard, game, summarizer, scraper/finder, ...) |
| Learning | MDX articles with frontmatter, dropped in a content folder. High-level and detailed topics. |
| Artifacts | Your own artifacts and uploads |
| Gallery | Other people's artifacts |
| Inspiration | Public datasets, problem articles, examples of AI tools others built |
| Admin | Invite people, view progress and content (host only) |

## The Gardener (agent)

- Persistent sidebar on the right, collapsible, available throughout the site.
- "Bring into context": the page/article you're viewing can be added to the agent's context.
- Paragraph-level chat: hover a paragraph in an article → chat-bubble button → ask about that specific part.
- Knows all learning articles (structured like skills: frontmatter `description` for selection, body loaded on demand) and the site's features.
- LLM via OpenRouter. Default model: Kimi K2.6 (strong agentic chat, cheap); user-selectable alternatives: DeepSeek V4, Qwen 3.7, and one free-tier model. Model picker is a feature, not a burden: default works out of the box.
- Future: expose as MCP server so participants can continue in Claude Code/Codex.

## Progressive flow

Per-user stage stored in DB: `invited → questionnaire → exploring`.

1. **Pre-workshop questionnaire** (interactive, conversational tone): do you have an LLM subscription; willingness to pay 0/5/20 per month; laptop/phone/tablet; open answer on expectations.
2. **Starter cards**: a few curated article sets + "Start brainstorming your first project" button.
3. **Full garden**: everything unlocked.

## Design system

- **Aesthetic:** modern Tufte with garden hints; LukeW functional design principles. Generous measure (~90ch typeset), serif headings (Merriweather via shadcn typeset), clean sans body, hairline rules, minimal chrome, high data-ink ratio. Garden hints = warm paper background, moss/leaf green accent palette, subtle organic touches; no kitsch.
- **Components:** shadcn/ui + Tailwind CSS v4. Icons: Lucide (shadcn default; Flowbite-adjacent style, zero friction).
- **No overwhelming lists:** lists beyond ~7 items get categorized drill-downs.
- Light + dark theme.
- Note: original mockup screenshot was not available in this session; design derived from the written description. Design pass against the mockup is a follow-up.

## Architecture

- **Platform:** Cloudflare Workers for everything via wrangler: hosting, D1 (SQLite) for data, R2 for uploads, KV for sessions/cache, Email (OTP delivery).
- **Framework:** React Router v7 (framework mode) + `@cloudflare/vite-plugin`. SSR on the Worker, full React interactivity for the agent sidebar. Officially supported Cloudflare template.
- **Content:** MDX files in `content/learning/*.mdx` with frontmatter (`title`, `description`, `category`, `level`, `order`). Compiled at build time; raw text also bundled so the agent can load any article into context ("articles as skills").
- **DB access:** Drizzle ORM on D1.
- **Auth:** email OTP for invited addresses (invites table, admin-managed) + Google OAuth as alternative. Session = signed HTTP-only cookie referencing a D1 session row. Dev mode logs OTP to console.
- **Agent backend:** Worker route streaming SSE from OpenRouter (`OPENROUTER_API_KEY` secret; `.env` locally). Context assembly: system prompt (site knowledge) + selected article skills + page context + paragraph snippet.

## Data model (initial)

`users` (id, email, name, role user/admin, stage, model_pref), `invites` (email, invited_by, status), `sessions`, `otp_codes`, `questionnaire_responses` (user_id, answers JSON), `projects` (user_id, title, status, brainstorm summary, modules JSON), `artifacts` (user_id, project_id?, type upload/link/build, r2_key?, title, visibility private/gallery), `chat_threads` + `chat_messages` (agent conversations, context refs JSON), `article_progress` (user_id, slug, read_at).

## Error handling & testing

- API routes return typed JSON errors; UI uses route error boundaries with friendly copy.
- Agent stream failures degrade to a retry affordance in the sidebar; model fallback on OpenRouter 4xx/5xx (auto-retry with default model).
- Tests: Vitest + `@cloudflare/vitest-pool-workers` for API/auth/agent-context units; component smoke tests where cheap. Playwright later if needed.

## Build order (modular blocks)

1. **UI framework** (this milestone): scaffold, design system, app shell (left nav, content area, agent sidebar placeholder), all routes with placeholder/sample content, MDX pipeline + 3 sample articles, responsive.
2. **Auth + invites + admin skeleton.**
3. **Agent**: streaming chat, context injection, paragraph-level ask, model picker.
4. **Idea Garden**: questionnaire, starter cards, projects + brainstorm flow.
5. **Artifacts/Gallery/Inspiration**: uploads to R2, visibility, curation.
6. **Polish + deploy + invite flow.**

Progress tracked in `docs/ROADMAP.md` (proposed convention: single roadmap file with checkboxes, one section per block; ADRs in `docs/adr/`).
