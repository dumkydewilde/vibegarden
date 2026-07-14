# Vibe Garden Phase 1: UI Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Cloudflare Workers app with the full Vibe Garden shell: design system, navigation, all section routes with quality placeholder content, MDX learning pipeline with sample articles, and a static agent-sidebar UI.

**Architecture:** React Router v7 framework mode (SSR on Workers via `@cloudflare/vite-plugin`). MDX articles compiled at build time via `@mdx-js/rollup`, discovered with `import.meta.glob`, raw text bundled for later agent use. shadcn/ui on Tailwind v4 with a custom Tufte-garden theme layer.

**Tech Stack:** React Router 7, Cloudflare Workers, Tailwind CSS v4, shadcn/ui, Lucide icons, MDX 3, Vitest.

## Global Constraints

- Cloudflare Workers only; everything managed by wrangler (spec).
- Typography: serif headings (Merriweather), sans body (Roboto), measure ~90ch for reading (spec: shadcn typeset settings).
- Garden palette accents; light + dark themes.
- No overwhelming lists: >7 items must be categorized (spec).
- Must work on phones/tablets/laptops, Windows + macOS browsers (spec).
- Content = drop-in `.mdx` files with frontmatter in `content/learning/` (spec).
- No em/en dashes in copy (user rule).

---

### Task 1: Scaffold + toolchain

**Files:**
- Create: entire app via `npm create cloudflare@latest vibe-garden -- --framework=react-router` in repo root, then flatten into repo root.
- Modify: `wrangler.jsonc` (name `vibe-garden`, enable observability), `.gitignore` (add `.env`, `.dev.vars`).
- Create: `docs/ROADMAP.md`, `CLAUDE.md` (project conventions: roadmap tracking, content folder, stack).

**Interfaces:**
- Produces: working `npm run dev` (wrangler/vite dev server), `npm run build`, `npm run typecheck`.

- [ ] Scaffold with cloudflare CLI, no git init (repo exists), no deploy.
- [ ] Verify `npm run build` and `npm run typecheck` pass.
- [ ] Add Vitest (`vitest`, `@testing-library/react`, `jsdom`) with `npm test` script; one trivial passing test `app/lib/__tests__/smoke.test.ts`.
- [ ] Commit: `feat: scaffold react-router 7 on cloudflare workers`.

### Task 2: Design system (tokens, fonts, theme)

**Files:**
- Create: `app/styles/theme.css` (imported from `app/app.css`): CSS custom properties for light/dark, garden palette, typography scale.
- Modify: `app/app.css` (Tailwind v4 `@theme` mapping, base typography).
- Create: `app/lib/fonts.ts` via `@fontsource/merriweather` + `@fontsource/roboto` imports in `app/root.tsx`.
- Init shadcn: `npx shadcn@latest init`, then add: button, card, badge, input, textarea, dialog, sheet, dropdown-menu, avatar, separator, tabs, tooltip, scroll-area, skeleton, sonner.
- Create: `app/components/theme-toggle.tsx` + cookie-based theme (no flash) in `root.tsx`.

**Interfaces:**
- Produces: Tailwind tokens `--color-garden-*`, semantic shadcn vars themed for paper/moss aesthetic; `<ThemeToggle />`.

**Palette (locked):** paper `oklch(0.98 0.008 95)` bg light; ink `oklch(0.25 0.01 95)`; moss primary `oklch(0.52 0.09 150)`; leaf accent `oklch(0.72 0.12 130)`; clay `oklch(0.65 0.12 40)` for warnings; dark = deep loam bg `oklch(0.22 0.015 140)`.

- [ ] Implement tokens + fonts, verify in browser (light/dark).
- [ ] Commit: `feat: tufte-garden design system`.

### Task 3: App shell

**Files:**
- Create: `app/components/shell/app-shell.tsx` (grid: left nav / main / right agent rail), `app/components/shell/left-nav.tsx`, `app/components/shell/mobile-nav.tsx` (sheet + top bar under `md:`), `app/components/shell/page-header.tsx`.
- Create: `app/lib/nav.ts` — single source of nav items: garden, learning, artifacts, gallery, inspiration, admin (admin flagged `adminOnly`).
- Modify: `app/root.tsx`, `app/routes.ts`, layout route `app/routes/_app.tsx` wrapping all sections.

**Interfaces:**
- Produces: `<AppShell>` consumed by layout route; `navItems: {to, label, icon, adminOnly?}[]`.

- [ ] Desktop: persistent icon+label left nav (collapsible to icons); mobile: top bar + sheet menu.
- [ ] Active state, keyboard focusable, `aria-current`.
- [ ] Commit: `feat: app shell with responsive nav`.

### Task 4: Agent sidebar (static UI)

**Files:**
- Create: `app/components/gardener/agent-sidebar.tsx` (collapsible right rail, desktop; bottom sheet on mobile), `app/components/gardener/chat-message.tsx`, `app/components/gardener/context-chips.tsx`, `app/components/gardener/model-picker.tsx` (static list: Kimi K2.6 default, DeepSeek V4, Qwen 3.7), `app/components/gardener/gardener-provider.tsx` (React context: open/closed, pending context items, stub `ask(question, context?)`).

**Interfaces:**
- Produces: `useGardener()` → `{open, setOpen, contextItems, addContext(item), ask(q)}`; `AgentSidebar` rendered in `_app.tsx`. Phase 3 replaces stub `ask` with streaming.

- [ ] Static thread with welcome message from The Gardener, disabled composer note "coming soon" removed in phase 3 (composer works, echoes placeholder reply).
- [ ] Commit: `feat: gardener sidebar shell`.

### Task 5: MDX learning pipeline + sample content

**Files:**
- Modify: `vite.config.ts` (`@mdx-js/rollup` + `remark-frontmatter` + `remark-mdx-frontmatter`, remark-gfm).
- Create: `app/lib/content.ts` — collection via `import.meta.glob('/content/learning/*.mdx')` (modules) + `{query: '?raw'}` (raw for agent later); exports `getArticles(): ArticleMeta[]`, `getArticle(slug)`, grouping by `category`.
- Create: `content/learning/what-is-an-llm.mdx`, `what-is-an-agent.mdx`, `store-data-sheets-vs-database.mdx` (real, workshop-quality drafts, frontmatter: title, description, category, level, order).
- Create: `app/components/learning/article-card.tsx`, `app/routes/learning.tsx` (cards grouped by category), `app/routes/learning.$slug.tsx` (Tufte article layout, measure 90, MDX components map, paragraph hover chat-bubble stub calling `addContext`).
- Test: `app/lib/__tests__/content.test.ts` — collection returns sorted metas, slugs resolve, missing slug returns undefined.

**Interfaces:**
- Consumes: `useGardener().addContext`.
- Produces: `ArticleMeta = {slug, title, description, category, level, order}`; `getArticleRaw(slug)` for phase 3.

- [ ] Tests written first for `content.ts`, fail, implement, pass.
- [ ] Commit: `feat: mdx learning section with sample articles`.

### Task 6: Section pages (placeholder-but-real)

**Files:**
- Create: `app/routes/_index.tsx` (home: welcome + starter cards stub reflecting progressive flow step 2), `app/routes/garden.tsx` (empty-state: "Plant your first idea" + module chips), `app/routes/artifacts.tsx`, `app/routes/gallery.tsx`, `app/routes/inspiration.tsx` (3 curated dataset cards + 2 example stories, hardcoded), `app/routes/admin.tsx` (invite table mock + progress placeholder), `app/routes/join.tsx` (questionnaire teaser page, static).
- Create: `app/components/empty-state.tsx`.

**Interfaces:**
- Consumes: `AppShell`, shadcn cards.

- [ ] Every page has a purpose statement and a next action; no lorem ipsum.
- [ ] Commit: `feat: section pages`.

### Task 7: Verification + docs

- [ ] `npm run build && npm run typecheck && npm test` all green.
- [ ] Browser pass: mobile (375px) and desktop (1280px), light + dark.
- [ ] Update `docs/ROADMAP.md` (phase 1 done, next phases listed), `README.md` (run/deploy instructions).
- [ ] Commit: `docs: roadmap and readme`.
