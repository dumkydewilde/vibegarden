import { z } from "zod";
import { ARTIFACT_LIMITS } from "~/lib/artifacts/contracts";
import { PROJECT_LIMITS } from "~/lib/project-limits";
import { PROJECT_STATUSES } from "~/lib/project-status";

export const MCP_SCOPES = [
  "projects:read", "projects:write", "content:read",
  "artifacts:write", "artifacts:publish",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpPrincipal = {
  userId: string;
  clubId: string;
  scopes: McpScope[];
};
export type ResolvedMcpPrincipal = McpPrincipal & {
  clubSlug: string;
  clubName: string;
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
  "get_guidance",
  "fresh_reads",
  "search",
  "fetch",
  "create_project",
  "update_project",
  "create_artifact",
  "create_artifact_version",
  "share_artifact",
] as const;

export const listProjectsInput = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  cursor: z.string().max(2_000).optional(),
  page_size: z.number().int().positive().optional(),
}).strict();

const projectTitleInput = z.string().min(1).max(PROJECT_LIMITS.titleChars);
const projectOneLinerInput = z.string().max(PROJECT_LIMITS.oneLinerChars);
const projectNotesInput = z.string().max(PROJECT_LIMITS.notesChars);
/** A module display title or content slug; the server resolves either. */
const buildingBlocksInput = z
  .array(z.string().min(1).max(120))
  .max(PROJECT_LIMITS.buildingBlocks);

export const createProjectInput = z.object({
  title: projectTitleInput,
  one_liner: projectOneLinerInput.optional(),
  notes: projectNotesInput.optional(),
  building_blocks: buildingBlocksInput.optional(),
  idempotency_key: z.string().min(1).max(256),
}).strict();

export const UPDATE_PROJECT_FIELDS = [
  "title", "one_liner", "notes", "building_blocks", "status",
] as const;

export const updateProjectInput = z.object({
  project_id: z.string().min(1).max(200),
  title: projectTitleInput.optional(),
  one_liner: projectOneLinerInput.optional(),
  notes: projectNotesInput.optional(),
  building_blocks: buildingBlocksInput.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
}).strict().refine(
  (input) => UPDATE_PROJECT_FIELDS.some((field) => input[field] !== undefined),
  { message: "Provide at least one field to change." },
);

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

export const GUIDANCE_QUESTION_MAX = 300;

export const guidanceInput = z.object({
  question: z.string().min(3).max(GUIDANCE_QUESTION_MAX),
  kind: z.enum(["article", "module"]).optional(),
  max_items: z.number().int().positive().optional(),
}).strict();

export const planBuildPromptInput = z.object({
  goal: z.string().min(3).max(GUIDANCE_QUESTION_MAX),
}).strict();

export const freshReadsInput = z.object({
  topic: z.string().max(80).optional(),
  content_type: z.enum(["news", "opinion", "tutorial"]).optional(),
}).strict();

export const searchInput = z.object({ query: z.string().min(1).max(200) }).strict();
export const fetchInput = z.object({ id: z.string().min(1).max(300) }).strict();

const artifactTextFileInput = z.object({
  path: z.string().min(1).max(ARTIFACT_LIMITS.pathBytes),
  content: z.string().max(ARTIFACT_LIMITS.mcpBytes),
  mime_type: z.string().min(1).max(128).optional(),
}).strict();

export const createArtifactInput = z.object({
  project_id: z.string().min(1).max(200),
  title: z.string().min(1).max(ARTIFACT_LIMITS.titleChars),
  description: z.string().max(ARTIFACT_LIMITS.descriptionChars).optional(),
  files: z.array(artifactTextFileInput).min(1).max(ARTIFACT_LIMITS.mcpFiles),
  allowed_data_origins: z.array(z.string().max(2_048)).max(ARTIFACT_LIMITS.origins).optional(),
  idempotency_key: z.string().min(1).max(256),
}).strict();

export const createArtifactVersionInput = z.object({
  artifact_id: z.string().min(1).max(200),
  files: z.array(artifactTextFileInput).min(1).max(ARTIFACT_LIMITS.mcpFiles),
  allowed_data_origins: z.array(z.string().max(2_048)).max(ARTIFACT_LIMITS.origins).optional(),
  idempotency_key: z.string().min(1).max(256),
}).strict();

export const shareArtifactInput = z.object({
  artifact_id: z.string().min(1).max(200),
  version_id: z.string().min(1).max(200),
  confirm: z.literal(true),
}).strict();

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
  notes: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  building_blocks: z.array(z.string()),
  updated_at: z.number(),
  url: z.string().url(),
}).strict();

export const projectMutationOutput = projectOutput;

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

export const guidanceOutput = z.object({
  items: z.array(learningItemOutput.extend({ excerpt: z.string() }).strict()),
  related: z.array(learningItemOutput),
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

export const artifactMutationOutput = z.object({
  artifact_id: z.string(),
  version_id: z.string(),
  visibility: z.enum(["private", "gallery"]),
  url: z.string().url(),
}).strict();

export function clampPageSize(
  value: number | undefined,
  kind: "list" | "conversation",
) {
  const fallback = kind === "list" ? LIST_PAGE_DEFAULT : CONVERSATION_PAGE_DEFAULT;
  const maximum = kind === "list" ? LIST_PAGE_MAX : CONVERSATION_PAGE_MAX;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);
}
