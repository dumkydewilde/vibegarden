# Vibe Garden Phase 4: Questionnaire, Stage Gating, Projects

**Goal:** The progressive flow works end to end: first login lands on a friendly questionnaire, completing it unlocks the garden, and brainstorms can be planted as projects.

**Decisions (header):**
- Questionnaire at `/welcome` (auth required, no app shell: focused card flow like login). One question per step, back button, progress dots. Answers stored as JSON in `questionnaire_responses`; completing sets `users.stage = exploring`.
- Gating in the app layout loader: `stage = invited` redirects to `/welcome`. Admins bypass (the host should never be locked out). `/login`, `/join`, `/welcome` stay outside the shell.
- Answers shape: `{ subscription: chatgpt|claude|other|none, budget: 0|5|20|null (only asked when none), devices: laptop|phone|tablet[], expectations: string }`. Budget in euros/month.
- Projects table: id, user_id, title, one_liner, modules (JSON array of module names), status `seed|growing|bloomed`, thread_id (optional link to the brainstorm), created_at, updated_at. Status labels in UI: Seed / Growing / Bloomed.
- Create paths: (a) "Plant this as a project" button on a conversation transcript (title prefilled from the thread, redirects to the project page to refine), (b) "Plant an idea" manual form on the garden page.
- Project detail at `/garden/projects/:id`: edit title/one-liner/status/modules, link to its conversation, delete (with confirm).
- Modules list becomes a shared constant `app/lib/modules.ts` (garden chips, project forms, gardener prompt all read it).
- Admin participants list shows questionnaire answers as a one-line summary.
- System prompt: brainstorm wrap-up now says to plant the idea in the Idea Garden.

## Tasks

1. Schema + migration: `questionnaire_responses`, `projects`. Shared `modules.ts`.
2. `/welcome` questionnaire flow + gating in app layout + admin summary line.
3. Projects: garden list section, create actions (transcript + manual dialog), detail page with edit/delete.
4. Prompt tweak, tests (answer validation, project helpers), browser pass, roadmap.
