import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type PlatformRole = "user" | "super_admin";
export type ClubRole = "owner" | "admin" | "member";
export type ClubStatus = "active" | "archived";
export type ModelPolicy = "free_only" | "all_models";
export type ProvisioningState = "pending" | "ready" | "failed" | "disabled";
export type OnboardingStage = "invited" | "questionnaire" | "exploring";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** @deprecated Removed after the multi-club contract migration. */
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  /** @deprecated Replaced by club_memberships.onboarding_stage. */
  stage: text("stage", { enum: ["invited", "questionnaire", "exploring"] })
    .notNull()
    .default("invited"),
  /** @deprecated Replaced by club_memberships.model_pref. */
  modelPref: text("model_pref"),
  platformRole: text("platform_role", { enum: ["user", "super_admin"] })
    .notNull()
    .default("user"),
  themePref: text("theme_pref"),
  lastClubId: text("last_club_id"),
  createdAt: integer("created_at").notNull(),
});

export const clubs = sqliteTable(
  "clubs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    modelPolicy: text("model_policy", { enum: ["free_only", "all_models"] })
      .notNull()
      .default("all_models"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    spendingLimitUsd: integer("spending_limit_usd"),
    spendingLimitReset: integer("spending_limit_reset"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [uniqueIndex("clubs_slug_unique").on(table.slug)],
);

export const clubMemberships = sqliteTable(
  "club_memberships",
  {
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    onboardingStage: text("onboarding_stage", {
      enum: ["invited", "questionnaire", "exploring"],
    })
      .notNull()
      .default("invited"),
    modelPref: text("model_pref"),
    joinedAt: integer("joined_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clubId, table.userId] }),
    index("club_memberships_club_id_idx").on(table.clubId),
    index("club_memberships_user_id_idx").on(table.userId),
  ],
);

export const clubSlugAliases = sqliteTable(
  "club_slug_aliases",
  {
    slug: text("slug").primaryKey(),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("club_slug_aliases_club_id_idx").on(table.clubId)],
);

export const clubInvitations = sqliteTable(
  "club_invitations",
  {
    id: text("id").primaryKey(),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: text("status", { enum: ["pending", "joined", "revoked"] })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    acceptedAt: integer("accepted_at"),
  },
  (table) => [
    uniqueIndex("club_invitations_club_id_email_unique").on(
      table.clubId,
      table.email,
    ),
    index("club_invitations_club_id_idx").on(table.clubId),
  ],
);

export const clubInviteLinks = sqliteTable(
  "club_invite_links",
  {
    id: text("id").primaryKey(),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    maxJoins: integer("max_joins"),
    currentJoins: integer("current_joins").notNull().default(0),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("club_invite_links_token_hash_unique").on(table.tokenHash),
    index("club_invite_links_club_id_idx").on(table.clubId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clubId: text("club_id").references(() => clubs.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: text("metadata"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("audit_events_club_id_idx").on(table.clubId)],
);

export const clubAiCredentials = sqliteTable(
  "club_ai_credentials",
  {
    clubId: text("club_id")
      .primaryKey()
      .references(() => clubs.id, { onDelete: "cascade" }),
    keyHash: text("key_hash"),
    keySuffix: text("key_suffix"),
    remoteWorkspaceId: text("remote_workspace_id"),
    remoteGuardrailId: text("remote_guardrail_id"),
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    keyVersion: integer("key_version").notNull().default(1),
    provisioningState: text("provisioning_state", {
      enum: ["pending", "ready", "failed", "disabled"],
    })
      .notNull()
      .default("pending"),
    syncedPolicy: text("synced_policy", { enum: ["free_only", "all_models"] }),
    lastAttemptAt: integer("last_attempt_at"),
    lastSyncedAt: integer("last_synced_at"),
    sanitizedError: text("sanitized_error"),
    candidateKeyHash: text("candidate_key_hash"),
    candidateKeySuffix: text("candidate_key_suffix"),
    candidateCiphertext: text("candidate_ciphertext"),
    candidateIv: text("candidate_iv"),
  },
  (table) => [index("club_ai_credentials_club_id_idx").on(table.clubId)],
);

export const aiReconciliationFindings = sqliteTable(
  "ai_reconciliation_findings",
  {
    id: text("id").primaryKey(),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    remoteId: text("remote_id"),
    status: text("status").notNull(),
    metadata: text("metadata"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [index("ai_reconciliation_findings_club_id_idx").on(table.clubId)],
);

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

export const chatThreads = sqliteTable(
  "chat_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Set when the conversation belongs to a project in the Idea Garden. */
    projectId: text("project_id"),
    /** Nullable until the multi-club contract migration. */
    clubId: text("club_id").references(() => clubs.id),
    createdAt: integer("created_at").notNull(),
    /** Bumped on every message and on "continue"; newest thread is active. */
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (table) => [index("chat_threads_club_id_idx").on(table.clubId)],
);

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

export const questionnaireResponses = sqliteTable(
  "questionnaire_responses",
  {
    /** Nullable until the multi-club contract migration. */
    clubId: text("club_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** JSON: { subscription, budget, devices, expectations } */
    answers: text("answers").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clubId, table.userId] }),
    index("questionnaire_responses_club_id_idx").on(table.clubId),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Nullable until the multi-club contract migration. */
    clubId: text("club_id").references(() => clubs.id),
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
  },
  (table) => [index("projects_club_id_idx").on(table.clubId)],
);

/**
 * Participant-visible discussion attached to a target by string, not FK:
 * articles are file-based (slug), inspiration cards live in code. `parentId`
 * is reserved for one-level replies; nothing writes it yet.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", {
      enum: ["article", "inspiration", "artifact"],
    }).notNull(),
    targetId: text("target_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Nullable until the multi-club contract migration. */
    clubId: text("club_id").references(() => clubs.id),
    parentId: text("parent_id"),
    body: text("body").notNull(),
    status: text("status", { enum: ["visible", "hidden"] })
      .notNull()
      .default("visible"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("comments_club_id_idx").on(table.clubId)],
);

/** Private feedback to the admin, not attached to any target. */
export const siteFeedback = sqliteTable(
  "site_feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Nullable until the multi-club contract migration. */
    clubId: text("club_id").references(() => clubs.id),
    /** Path the feedback was sent from, e.g. "/learning/what-is-an-agent". */
    page: text("page"),
    body: text("body").notNull(),
    status: text("status", { enum: ["new", "read", "resolved"] })
      .notNull()
      .default("new"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("site_feedback_club_id_idx").on(table.clubId)],
);

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Club = typeof clubs.$inferSelect;
export type ClubMembership = typeof clubMemberships.$inferSelect;
export type ClubInvitation = typeof clubInvitations.$inferSelect;
export type ClubInviteLink = typeof clubInviteLinks.$inferSelect;
export type ClubAiCredential = typeof clubAiCredentials.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type AiReconciliationFinding =
  typeof aiReconciliationFindings.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type SiteFeedback = typeof siteFeedback.$inferSelect;
