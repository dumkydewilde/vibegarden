# Vibe Garden

A workshop environment for friends learning to build with AI/LLMs. See
`docs/specs/2026-07-14-vibe-garden-design.md` for the full design.

## Conventions

- **Task tracking:** `docs/ROADMAP.md` is the single source of truth. Update it
  when work lands. Plans in `docs/plans/`, ADRs in `docs/adr/`.
- **Stack:** React Router 7 (framework mode) on Cloudflare Workers,
  Tailwind v4 + shadcn/ui, Lucide icons, MDX content, Vitest.
- **Content:** learning articles are `.mdx` files with frontmatter in
  `content/learning/`. Drop a file in, it appears on the site. Building-block
  know-how works the same way in `content/modules/` (drill-down pages at
  /garden/modules plus the Gardener's `read_module` tool). Quote frontmatter
  values that contain a colon.
- **Gardener system prompt:** `content/gardener/system-prompt.md`, plain
  markdown with `{{ARTICLE_INDEX}}`, `{{MODULES}}`, `{{CURRENT_PAGE_RULE}}`,
  `{{TOOLS_RULE}}` placeholders filled in by `app/lib/gardener.server.ts`.
  Edit the file, reload, done.
- **Path alias:** `~/*` maps to `app/*`.
- **Design:** modern Tufte with garden hints. Serif headings (Merriweather),
  sans body (Roboto), ~90ch reading measure, minimal chrome, garden palette.
  Tokens live in `app/app.css`. No overwhelming lists: over ~7 items,
  categorize and drill down.
- **Copy:** no em or en dashes, use a comma or colon.

## Commands

- `npm run dev` — dev server (workerd runtime via Vite plugin)
- `npm run build` — production build
- `npm run typecheck` — react-router typegen + tsc
- `npm test` — vitest run
- `npm run deploy` — build + wrangler deploy
- `npm run cf-typegen` — regenerate worker-configuration.d.ts after wrangler.jsonc changes

## Machine notes

- npm on this machine has `prefer-offline=true` in `~/.npmrc`; if installs fail
  with "notarget" for versions that exist, add
  `--cache <fresh-dir>` or `--prefer-online` to bust stale metadata.
