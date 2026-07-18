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

## MCP connection

Vibe Garden exposes a read-only remote MCP server at
`https://vibegarden.dumky.net/mcp`. Setup details are public at `/connect` and
data-use information at `/privacy/mcp`. People can revoke a connected app from
`/settings/connections` after signing in.

For local OAuth development, put these overrides and the normal session secret
in `.dev.vars`; the resource and issuer must match the Vite Worker origin
exactly:

```dotenv
SESSION_SECRET=replace-with-a-local-secret
APP_ORIGIN=http://localhost:5173
MCP_RESOURCE_URL=http://localhost:5173/mcp
```

Create the OAuth KV namespace and bind it as `OAUTH_KV` in `wrangler.jsonc`
before deploying the MCP server. The production Worker also needs the
`MCP_GENERAL_LIMITER` and `MCP_HISTORY_LIMITER` bindings shown there.

```sh
npm run test:mcp       # Worker/OAuth integration suite
npm run mcp:inspect    # inspect a running MCP endpoint
```

Before a release, follow the [Gardener MCP release checklist](docs/testing/gardener-mcp-release-checklist.md).
It includes the local Inspector protocol and the required staging verification
in Claude and ChatGPT. The cross-user isolation checks in both real hosts are
release-blocking; a local Worker test alone does not pass that gate.

Deploy in this order: create D1 and apply migrations, create and bind OAuth KV
and rate limiters, set `SESSION_SECRET` plus any reviewer secrets, then deploy
the Worker. Do not put production secrets in `.dev.vars` or source control.

### Reviewer data

Set `MCP_REVIEW_EMAIL` and `MCP_REVIEW_PASSWORD` as Worker secrets to enable
the isolated `/review/login` page. It creates a normal user session only. To
load the deterministic reviewer sample after deployment, run:

```sh
MCP_REVIEW_EMAIL=reviewer@example.test node scripts/seed-mcp-reviewer.mjs
```

The seeder is idempotent and uses `--remote`; it writes only its deterministic
reviewer user, projects, conversations, and messages. Review the target
environment before running it. Do not run it as part of local development or
tests.

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

## Multi-club configuration

The multi-club implementation is ready locally. Its production rollout has not
been performed. Use [the rollout runbook](docs/runbooks/multi-club-rollout.md)
only after explicit authorization for the named Cloudflare environment and
OpenRouter workspace.

Club-managed Gardener credentials require these production secrets:

- `OPENROUTER_MANAGEMENT_KEY`: OpenRouter Management API key used server-side
  to create and reconcile club credentials and guardrails.
- `OPENROUTER_CREDENTIAL_KEY_V1`: a base64-encoded, 32-byte AES-GCM key used
  to encrypt club credentials before they are written to D1.
- `OPENROUTER_WORKSPACE_ID`: optional OpenRouter workspace that owns managed
  club credentials.

`OPENROUTER_API_KEY` is only the temporary WOTF fallback during the rollout.
Do not remove it until WOTF has a ready dedicated credential and a Gardener
request has succeeded. Plaintext OpenRouter keys and raw invitation tokens are
never stored in recoverable form in D1. Keep the original secret material and
the one-time invitation URL outside D1.

The Worker runs reconciliation at minute 17 of every hour (UTC). It checks
managed credentials and guardrail assignments, records sanitized findings, and
does not log provider secrets or private content.

## Deploy

First time (creates the D1 database, applies migrations, sets secrets from
`.dev.vars`, deploys):

```sh
wrangler login
./scripts/first-deploy.sh
```

After that, `npm run deploy` for code changes and `npm run db:migrate:prod`
after schema changes. Local secrets go in `.dev.vars` (see
`.dev.vars.example`). For an existing production database, do not use this
script as a multi-club upgrade shortcut; follow the approval-gated runbook.
