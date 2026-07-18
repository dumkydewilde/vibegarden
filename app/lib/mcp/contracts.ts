import { z } from "zod";

export const MCP_SCOPES = ["projects:read", "content:read"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpPrincipal = {
  userId: string;
  clubId: string;
  scopes: McpScope[];
};
export const LIST_PAGE_DEFAULT = 20;
export const LIST_PAGE_MAX = 50;
export const CONVERSATION_PAGE_DEFAULT = 50;
export const CONVERSATION_PAGE_MAX = 100;
export const BODY_MAX_CHARS = 20_000;
export const RESPONSE_MAX_CHARS = 100_000;
export const MCP_TOOL_ORDER = [
  "list_projects",
  "get_project",
  "list_project_conversations",
  "get_conversation",
  "list_learning_content",
  "read_article",
  "read_module",
  "fresh_reads",
  "search",
  "fetch",
] as const;

export const listProjectsInput = z.object({
  status: z.enum(["seed", "growing", "bloomed"]).optional(),
  cursor: z.string().max(2_000).optional(),
  page_size: z.number().int().positive().optional(),
}).strict();

export const getProjectInput = z.object({
  project_id: z.string().min(1).max(200),
}).strict();

export const listProjectConversationsInput = z.object({
  project_id: z.string().min(1).max(200),
  cursor: z.string().max(2_000).optional(),
  page_size: z.number().int().positive().optional(),
}).strict();

export const getConversationInput = z.object({
  conversation_id: z.string().min(1).max(200),
  cursor: z.string().max(2_000).optional(),
  page_size: z.number().int().positive().optional(),
}).strict();

export const listLearningContentInput = z.object({
  query: z.string().max(200).optional(),
  kind: z.enum(["article", "module"]).optional(),
  category: z.string().max(100).optional(),
  cursor: z.string().max(2_000).optional(),
  page_size: z.number().int().positive().optional(),
}).strict();

export const slugInput = z.object({ slug: z.string().min(1).max(200) }).strict();

export const freshReadsInput = z.object({
  topic: z.string().max(80).optional(),
  content_type: z.enum(["news", "opinion", "tutorial"]).optional(),
}).strict();

export const searchInput = z.object({ query: z.string().min(1).max(200) }).strict();
export const fetchInput = z.object({ id: z.string().min(1).max(300) }).strict();

const conversationSummaryOutput = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updated_at: z.number(),
  message_count: z.number(),
  url: z.string().url(),
}).strict();

const projectOutput = z.object({
  id: z.string(),
  title: z.string(),
  one_liner: z.string().nullable(),
  status: z.enum(["seed", "growing", "bloomed"]),
  building_blocks: z.array(z.string()),
  updated_at: z.number(),
  url: z.string().url(),
}).strict();

export const listProjectsOutput = z.object({
  projects: z.array(projectOutput),
  next_cursor: z.string().optional(),
}).strict();

export const getProjectOutput = projectOutput.extend({
  conversations: z.array(conversationSummaryOutput),
}).strict();

export const listProjectConversationsOutput = z.object({
  conversations: z.array(conversationSummaryOutput),
  next_cursor: z.string().optional(),
}).strict();

export const getConversationOutput = z.object({
  conversation: z.object({
    id: z.string(),
    title: z.string().nullable(),
    updated_at: z.number(),
    url: z.string().url(),
  }).strict(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    context: z.array(z.object({
      label: z.string(),
      source: z.literal("user-authored context"),
    }).strict()),
    created_at: z.number(),
  }).strict()),
  next_cursor: z.string().optional(),
}).strict();

const learningItemOutput = z.object({
  kind: z.enum(["article", "module"]),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  level: z.enum(["starter", "hands-on"]).optional(),
  url: z.string().url(),
}).strict();

export const listLearningContentOutput = z.object({
  items: z.array(learningItemOutput),
  next_cursor: z.string().optional(),
}).strict();

export const articleOutput = learningItemOutput.extend({
  kind: z.literal("article"),
  level: z.enum(["starter", "hands-on"]),
  body: z.string(),
}).strict();

export const moduleOutput = learningItemOutput.extend({
  kind: z.literal("module"),
  body: z.string(),
}).strict();

export const freshReadsOutput = z.object({
  items: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    content_type: z.string(),
    source_url: z.string(),
    key_insight: z.string().optional(),
  }).strict()),
}).strict();

/** Exact company-knowledge search result payload. */
export const searchOutput = z.object({
  results: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
  }).strict()),
}).strict();

/** Exact company-knowledge fetch result payload. */
export const fetchOutput = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string().url(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export function clampPageSize(
  value: number | undefined,
  kind: "list" | "conversation",
) {
  const fallback = kind === "list" ? LIST_PAGE_DEFAULT : CONVERSATION_PAGE_DEFAULT;
  const maximum = kind === "list" ? LIST_PAGE_MAX : CONVERSATION_PAGE_MAX;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);
}
