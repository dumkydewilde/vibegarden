# Comments & discussion

Plan for participant-visible discussion on content, plus a private feedback
channel to the admin. Feedback tool for the workshop: friends leave notes on
articles and inspiration cards, and can flag anything about the site.

## Decisions (folded in, no separate spec)

- **Two shapes, two tables.** Discussion (articles, cards, later artifacts) is
  *participant-visible* and attached to a target. Site feedback (P3) is
  *admin-only* and not attached to anything. Different visibility and lifecycle,
  so `comments` and `site_feedback` are separate tables, not one polymorphic one.
- **Targets are referenced by string, not FK.** Articles are file-based
  (slug = MDX filename) and inspiration cards live in code, so `comments` uses
  `target_type` + `target_id` (a slug/card-id string), not a foreign key.
- **Chronological, flat, with a reply column reserved.** P1 renders oldest-first
  like a thread. A nullable `parent_id` ships in the first migration so one-level
  replies can be added later with no schema change.
- **House style.** `crypto.randomUUID()` ids, `Date.now()` integer timestamps,
  intent-dispatched `Form` → action, business logic in `app/lib/comments.server.ts`
  and `app/lib/feedback.server.ts`, queries scoped by `userId` for ownership.
- **Moderation is delete, for now.** A `status` column exists for the future,
  but P1 actions are: post, delete-own, admin-delete-any. No hide UI yet.
- **Not piping comments into the Gardener yet.** The `ContextItem` union stays as
  is. Revisit if participants want to "discuss this comment with the Gardener".

## Data model

```ts
// app/db/schema.ts — add
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  targetType: text("target_type", { enum: ["article", "inspiration", "artifact"] }).notNull(),
  targetId: text("target_id").notNull(),        // article slug, inspiration card id, artifact id
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),                   // reserved for replies; null = top-level
  body: text("body").notNull(),
  status: text("status", { enum: ["visible", "hidden"] }).notNull().default("visible"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const siteFeedback = sqliteTable("site_feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  page: text("page"),                            // path where it was submitted
  body: text("body").notNull(),
  status: text("status", { enum: ["new", "read", "resolved"] }).notNull().default("new"),
  createdAt: integer("created_at").notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type SiteFeedback = typeof siteFeedback.$inferSelect;
```

Migration: edit `schema.ts` → `npm run db:generate` (writes `drizzle/0005_*.sql`)
→ `npm run db:migrate` (local). Prod: `db:migrate:prod` at deploy time.

## Phases

### P1 — Article comments

1. **Schema + migration** for `comments` (both tables can land together; only
   `comments` is wired up in P1).
2. **`app/lib/comments.server.ts`**: `listComments(env, targetType, targetId)`
   (join `users` for display name, `status = "visible"`, oldest-first),
   `createComment(env, userId, {targetType, targetId, body})` (trim, cap ~4000
   chars, reject empty), `deleteComment(env, user, id)` (own comment, or admin).
3. **`learning.$slug.tsx`**: extend the loader (currently 404-only) to fetch
   comments for the slug and the current user; add an intent-dispatched action
   (`comment`, `delete`).
4. **`app/components/comments/comment-thread.tsx`**: list + `Form` composer,
   mirroring the project-edit form (Textarea, `useNavigation()` busy state,
   inline error). Each comment shows author, relative time, and a delete control
   when `user.id === comment.userId || user.role === "admin"`. Render it at the
   bottom of the article page.
5. **Tests** (Vitest): `comments.server.ts` unit tests (create trims/caps/rejects
   empty; delete enforces ownership + admin override; list filters hidden and
   orders chronologically). Component render test for empty + populated states.
6. **Verify** in the browser: post, see it appear, delete own, admin deletes
   another's; light + dark.

### P2 — Inspiration card comments

- Inspiration cards have no stable id today (keyed by title). Add a `slug`/`id`
  field to `InspirationItem` and `DatasetItem` (`inspiration.tsx`,
  `inspiration-datasets.ts`). Aligns with the open roadmap TODO to move cards to
  content files; do the minimal id addition now, full content migration separately.
- Cards are on a single list page with no detail route. Add a `Dialog` (shadcn,
  already present) or a `/inspiration/:id` detail route to host the thread.
  Decide when we get here; a dialog is lighter and keeps the browsing flow.
- Reuse `comment-thread.tsx` with `targetType="inspiration"`.

### P3 — Site feedback to admin

- Wire `siteFeedback`: `app/lib/feedback.server.ts` (`submitFeedback`,
  `listFeedback`, `setFeedbackStatus`), a small composer (footer link or a
  persistent "Feedback" button that captures the current path into `page`),
  and an admin section in `admin.tsx` (new `Card`, intent-dispatched status
  updates, mirroring the invite/participant pattern).

### Later — Artifact comments

- `comments` already supports `target_type = "artifact"`. Wire it up when
  Phase 5 R2 uploads + artifact records exist and each artifact has a detail
  page to host the thread.

## Out of scope (for now)

- Rich text / markdown in comments (plain text first).
- Notifications / email on new comments.
- Editing a posted comment (delete + repost).
- Piping comments into the Gardener context.
