---
name: verify
description: Build, run, and drive Vibe Garden locally to verify a change end-to-end (login, articles, Gardener chat).
---

# Verifying Vibe Garden changes

## Launch

- `npm run dev` (background). It picks the first free port from 5173, read
  the actual port from the output. Needs `.dev.vars` (present via
  Conductor's `.worktreeinclude`).
- Orphaned dev servers from other sessions may hold 5173; do not assume the
  port, and remember localStorage is per-origin including port (panel-open
  state, etc. won't carry over between ports).

## Login (OTP, no email needed)

1. Go to `/login`, submit the admin email from `wrangler.jsonc` vars
   (`ADMIN_EMAIL`). Admins bypass the invite list and the /welcome gate.
2. Resend can't deliver locally (403, unverified domain), so the page
   shows the code inline in dev. If it doesn't, read it from local D1:

   ```bash
   find .wrangler/state -name '*.sqlite' | while read f; do
     sqlite3 "$f" "SELECT code FROM otp_codes WHERE email='<email>'" 2>/dev/null
   done
   ```

## Flows worth driving

- Articles: `/learning/<slug>`; building blocks: `/garden/modules/<slug>`.
  Link rendering: article/module links are inline cards (`a[data-card]`),
  external links `target=_blank` + outlink icon.
- Gardener chat: "Ask the Gardener" button (bottom right) opens the panel;
  it must survive client-side navigation, including mid-stream. A real
  OPENROUTER_API_KEY is in `.dev.vars`, so asks hit the live model: keep
  questions short. Thread history persists in local D1 across reloads.

## Gotchas

- Known pre-existing hydration mismatch: the Gardener panel open state is
  read from localStorage in a useState initializer, so SSR (closed) and
  client (open) disagree when the panel was left open. Ignore unless the
  diff touches it.
