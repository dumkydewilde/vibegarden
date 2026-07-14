# Vibe Garden

A friendly workshop environment for learning to build with AI/LLMs, together.
Learning articles, an agent helper (The Gardener), a project space (Idea
Garden), artifacts, a gallery, and inspiration. Built for a summer workshop
with 10-15 friends.

- **Spec:** [docs/specs/2026-07-14-vibe-garden-design.md](docs/specs/2026-07-14-vibe-garden-design.md)
- **Progress:** [docs/ROADMAP.md](docs/ROADMAP.md)

## Stack

React Router 7 (framework mode) on Cloudflare Workers, Tailwind v4 +
shadcn/ui, MDX content, Vitest. Later phases add D1 (auth, projects), R2
(uploads), and an OpenRouter-backed agent.

## Develop

```sh
npm install
npm run dev        # dev server on :5173 (workerd runtime)
npm test           # vitest
npm run typecheck  # react-router typegen + tsc
```

## Content

Learning articles are MDX files in `content/learning/`. Drop in a file with
frontmatter and it appears on the site:

```mdx
---
title: My article
description: One sentence that sells it.
category: Foundations
level: starter
order: 3
---

Body in markdown...
```

## Deploy

```sh
npm run deploy     # build + wrangler deploy
```

Secrets (later phases): copy `.dev.vars.example` to `.dev.vars` for local dev;
`wrangler secret put` for production.
