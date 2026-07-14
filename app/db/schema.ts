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

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
