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

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
