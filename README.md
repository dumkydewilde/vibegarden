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

## Auth model

Invite-only. Participants sign in at `/login` with an email code (OTP), or
Google when configured. `ADMIN_EMAIL` in wrangler.jsonc can always sign in
and gets the admin role; everyone else needs an invite created in `/admin`.
Without `RESEND_API_KEY` the login screen shows the code inline instead of
emailing it.

## Database

Local D1 runs automatically in dev. Schema lives in `app/db/schema.ts`.

```sh
npm run db:generate  # new migration after schema changes
npm run db:migrate   # apply locally
```

## Deploy

```sh
wrangler d1 create vibe-garden        # once; put the id in wrangler.jsonc
npm run db:migrate:prod               # apply migrations remotely
wrangler secret put SESSION_SECRET    # long random string
wrangler secret put RESEND_API_KEY    # optional, real OTP emails
npm run deploy
```

Local secrets go in `.dev.vars` (see `.dev.vars.example`).
