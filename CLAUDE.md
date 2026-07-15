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
  `{{TOOLS_RULE}}`, `{{AUDIENCE}}` placeholders filled in by
  `app/lib/gardener.server.ts`. Edit the file, reload, done. The audience
  section (the friends' shared interests, used subtly) lives in
  `content/gardener/audience.md`; turn it off with `enabled: false` in its
  frontmatter, or delete the file.
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

## Local dev

- Login needs `SESSION_SECRET` in `.dev.vars` (any string locally); without it
  auth fails loudly with a "SESSION_SECRET is not set" error. Conductor copies
  `.dev.vars` into new workspaces via `.worktreeinclude`, sourced from the
  root checkout at `~/code/vibegarden`, so keep the real values (incl.
  `OPENROUTER_API_KEY`) in that root copy.
- `MOTHERDUCK_TOKEN` (read-scaling token preferred) enables the Gardener's
  `fresh_reads` tool; without it the tool simply is not offered. Queries go
  to MotherDuck's Postgres-compatible endpoint with DuckDB SQL via `pg`.
  Careful: MotherDuck shares are region-scoped and dumky_share_public lives
  in us-east-1, while the app's vibegarden account is eu-central-1, so that
  account holds a synced copy (`dumky_share.raw.rss_feed_summaries`) instead
  of attaching the share. Refresh it with `scripts/sync-fresh-reads.sh`.
  `SELECT region FROM md_user_info()` shows an account's region.

## Machine notes

- npm on this machine has `prefer-offline=true` in `~/.npmrc`; if installs fail
  with "notarget" for versions that exist, add
  `--cache <fresh-dir>` or `--prefer-online` to bust stale metadata.
