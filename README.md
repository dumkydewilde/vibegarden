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

### Development auto-login

For browser automation, set a local secret in `.dev.vars` (do not deploy this
secret):

```sh
DEV_LOGIN_TOKEN=use-a-long-random-value
```

Then open `/dev/login?token=<url-encoded-token>&next=/garden`. It signs in as
`ADMIN_EMAIL`, creates the same session as the normal login flow, and redirects
to `next` so the token is removed from the address bar. The route returns 404
when the token is missing or invalid; `next` only accepts an in-app path.

## Database

Local D1 runs automatically in dev. Schema lives in `app/db/schema.ts`.

```sh
npm run db:generate  # new migration after schema changes
npm run db:migrate   # apply locally
```

## Deploy

First time (creates the D1 database, applies migrations, sets secrets from
`.dev.vars`, deploys):

```sh
wrangler login
./scripts/first-deploy.sh
```

After that, `npm run deploy` for code changes and `npm run db:migrate:prod`
after schema changes. Local secrets go in `.dev.vars` (see
`.dev.vars.example`).
