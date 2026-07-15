import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  stage: text("stage", { enum: ["invited", "questionnaire", "exploring"] })
    .notNull()
    .default("invited"),
  modelPref: text("model_pref"),
  createdAt: integer("created_at").notNull(),
});

export const invites = sqliteTable("invites", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by"),
  status: text("status", { enum: ["pending", "joined", "revoked"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const otpCodes = sqliteTable("otp_codes", {
  email: text("email").primaryKey(),
  code: text("code").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  /** Set when the conversation belongs to a project in the Idea Garden. */
  projectId: text("project_id"),
  createdAt: integer("created_at").notNull(),
  /** Bumped on every message and on "continue"; newest thread is active. */
  updatedAt: integer("updated_at").notNull().default(0),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => chatThreads.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  /** JSON array of context items sent along with a user message. */
  context: text("context"),
  createdAt: integer("created_at").notNull(),
});

export const questionnaireResponses = sqliteTable("questionnaire_responses", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** JSON: { subscription, budget, devices, expectations } */
  answers: text("answers").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  oneLiner: text("one_liner"),
  /** JSON array of module names from app/lib/modules.ts */
  modules: text("modules"),
  status: text("status", { enum: ["seed", "growing", "bloomed"] })
    .notNull()
    .default("seed"),
  threadId: text("thread_id").references(() => chatThreads.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Participant-visible discussion attached to a target by string, not FK:
 * articles are file-based (slug), inspiration cards live in code. `parentId`
 * is reserved for one-level replies; nothing writes it yet.
 */
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  targetType: text("target_type", {
    enum: ["article", "inspiration", "artifact"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  body: text("body").notNull(),
  status: text("status", { enum: ["visible", "hidden"] })
    .notNull()
    .default("visible"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Private feedback to the admin, not attached to any target. */
export const siteFeedback = sqliteTable("site_feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Path the feedback was sent from, e.g. "/learning/what-is-an-agent". */
  page: text("page"),
  body: text("body").notNull(),
  status: text("status", { enum: ["new", "read", "resolved"] })
    .notNull()
    .default("new"),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type SiteFeedback = typeof siteFeedback.$inferSelect;
