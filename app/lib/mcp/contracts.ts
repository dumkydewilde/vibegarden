export const MCP_SCOPES = ["projects:read", "content:read"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpPrincipal = { userId: string; scopes: McpScope[] };
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

export function clampPageSize(
  value: number | undefined,
  kind: "list" | "conversation",
) {
  const fallback = kind === "list" ? LIST_PAGE_DEFAULT : CONVERSATION_PAGE_DEFAULT;
  const maximum = kind === "list" ? LIST_PAGE_MAX : CONVERSATION_PAGE_MAX;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);
}
