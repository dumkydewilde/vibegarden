import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getArticleRaw, getArticles } from "~/lib/content";
import gardenerGuide from "../../../content/gardener/mcp-guide.md?raw";
import { getModules, getModuleRaw, resolveModuleName } from "~/lib/modules";
import {
  createProject,
  getProject,
  listProjectsPage,
  updateProject,
} from "~/lib/projects.server";
import {
  createLinkArtifactForScope,
  createLinkArtifactVersionForScope,
  createTextArtifact,
  createTextArtifactVersion,
  shareArtifactVersionForScope,
} from "~/lib/artifacts/service.server";
import {
  artifactMutationOutput,
  articleOutput,
  clampPageSize,
  createArtifactInput,
  createArtifactVersionInput,
  createProjectInput,
  fetchInput,
  fetchOutput,
  freshReadsInput,
  freshReadsOutput,
  getConversationInput,
  getConversationOutput,
  getProjectInput,
  getProjectOutput,
  guidanceInput,
  guidanceOutput,
  listLearningContentInput,
  listLearningContentOutput,
  listProjectConversationsInput,
  listProjectConversationsOutput,
  listProjectsInput,
  listProjectsOutput,
  moduleOutput,
  planBuildPromptInput,
  projectMutationOutput,
  searchInput,
  searchOutput,
  shareArtifactInput,
  slugInput,
  updateProjectInput,
  type ResolvedMcpPrincipal,
  type McpScope,
} from "~/lib/mcp/contracts";
import { runMcpProtocolRequest, runMcpTool } from "~/lib/mcp/auth.server";
import { toMcpArtifactError } from "~/lib/mcp/artifact-errors.server";
import { presentArtifactMutation } from "~/lib/mcp/artifact-presenter.server";
import { fetchKnowledge, searchKnowledge } from "~/lib/mcp/compatibility.server";
import {
  listLearningContent,
  presentArticle,
  presentGuidance,
  presentLibraryGuide,
  presentModule,
} from "~/lib/mcp/content-presenter";
import { decodeCursor, encodeCursor, type CursorPayload } from "~/lib/mcp/cursor.server";
import { McpPublicError } from "~/lib/mcp/errors.server";
import { presentConversationPage, presentConversationSummary, presentProject } from "~/lib/mcp/project-presenter.server";
import { getThreadPage, listProjectThreadsPage } from "~/lib/threads.server";

const MCP_INSTRUCTIONS = "Vibe Garden stores club-scoped projects, learning content, HTML artifacts, and saved links. Use supplied tools only for the connected club. For any how-to question about building, hosting data or files, calling APIs, or working with a coding agent, call get_guidance with the user's own question before answering from general recollection, then read_article or read_module for a whole piece. Create or update a project only when the user asks, list first to resolve an unknown project, and keep project notes to what the user would recognize as their own account of the work. Assemble complete root-index.html packages, use relative assets and exact HTTPS data origins, retry identical input with the same idempotency key, and create versions for revisions. To keep an external page instead of a package, call create_artifact with type \"link\" and its https url. Keep artifacts private unless the user explicitly asks to share. The connected host remains the speaking assistant; this server does not run or select a model.";

const securitySchemes = (scope: McpScope | McpScope[]) => [{
  type: "oauth2",
  scopes: Array.isArray(scope) ? scope : [scope],
}];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function metadata(scope: McpScope | McpScope[]) {
  return {
    annotations: readOnlyAnnotations,
    _meta: { securitySchemes: securitySchemes(scope) },
  };
}

function mutationMetadata(scope: McpScope, openWorldHint = false) {
  return {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint,
    },
    _meta: { securitySchemes: securitySchemes(scope) },
  };
}

function compatibilityResult(payload: Record<string, unknown>) {
  return {
    structuredContent: payload,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function shortResult(payload: Record<string, unknown>, summary: string) {
  return {
    structuredContent: payload,
    content: [{ type: "text" as const, text: summary }],
  };
}

function notFound(): never {
  throw new McpPublicError("not_found", "The requested item was not found.");
}

/**
 * Accepts building blocks as module titles or slugs and stores canonical
 * titles. The web form silently drops unknown names; a tool caller is told.
 */
function resolveBuildingBlocks(values: string[] | undefined) {
  if (values === undefined) return undefined;
  const resolved: string[] = [];
  for (const value of values) {
    const name = resolveModuleName(value);
    if (!name) {
      throw new McpPublicError(
        "invalid_input",
        `Unknown building block "${value.slice(0, 60)}". Use a module title or slug from list_learning_content.`,
      );
    }
    if (!resolved.includes(name)) resolved.push(name);
  }
  return resolved;
}

async function cursorPosition(
  env: Env,
  cursor: string | undefined,
  kind: string,
  isExpectedPosition: (position: CursorPayload["position"]) => boolean,
) {
  if (!cursor) return undefined;
  const decoded = await decodeCursor(env.SESSION_SECRET, kind, cursor);
  if (!isExpectedPosition(decoded.position)) {
    throw new McpPublicError("invalid_cursor", "The pagination cursor is invalid or expired.");
  }
  return decoded.position;
}

function isUpdatedAtPosition(position: CursorPayload["position"]): position is {
  updatedAt: number;
  id: string;
} {
  return "updatedAt" in position;
}

function isOffsetPosition(position: CursorPayload["position"]): position is { offset: number } {
  return "offset" in position;
}

function isCreatedAtPosition(position: CursorPayload["position"]): position is {
  createdAt: number;
  id: string;
} {
  return "createdAt" in position;
}

async function nextCursor(
  env: Env,
  kind: string,
  position: CursorPayload["position"] | undefined,
) {
  return position ? encodeCursor(env.SESSION_SECRET, { kind, position }) : undefined;
}

function run(
  env: Env,
  toolName: string,
  scope: McpScope | McpScope[],
  limiter: "general" | "history",
  requestId: string | number,
  handler: (principal: ResolvedMcpPrincipal) => Promise<
    Record<string, unknown>
    | ReturnType<typeof compatibilityResult>
    | ReturnType<typeof shortResult>
  >,
) {
  return runMcpTool({
    env,
    toolName,
    requestId: String(requestId),
    requiredScope: scope,
    limiter,
  }, handler);
}

export function createGardenerMcpServer(env: Env) {
  const server = new McpServer(
    { name: "vibe-garden", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  registerTools(server, env);
  registerResources(server, env);
  registerPrompts(server, env);
  return server;
}

function resourceVariable(value: unknown): string {
  const parsed = z.string().min(1).max(200).safeParse(value);
  if (!parsed.success) {
    throw new McpPublicError("invalid_input", "The request could not be completed.");
  }
  return parsed.data;
}

function resourceResult(uri: URL, mimeType: "application/json" | "text/markdown", text: string) {
  return {
    contents: [{ uri: uri.toString(), mimeType, text }],
  };
}

async function ownedProjectPayload(
  env: Env,
  principal: ResolvedMcpPrincipal,
  projectId: string,
) {
  const project = await getProject(env, principal, projectId);
  if (!project) return notFound();
  const conversations = await listProjectThreadsPage(
    env,
    principal,
    project.id,
    project.threadId,
    { limit: clampPageSize(undefined, "list") },
  );
  return presentProject(env.APP_ORIGIN, principal.clubSlug, project, {
    primary: project.threadId
      ? conversations.items.find((item) => item.id === project.threadId)
      : undefined,
    linked: conversations.items.filter((item) => item.id !== project.threadId),
  });
}

function registerResources(server: McpServer, env: Env) {
  server.registerResource("project", new ResourceTemplate("vibegarden://project/{id}", { list: undefined }), {
    title: "Project",
    mimeType: "application/json",
  }, async (uri, variables, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_project_resource",
    requestId: String(extra.requestId),
    requiredScope: "projects:read",
    limiter: "general",
    kind: "resource",
  }, async (principal) => {
    const projectId = resourceVariable(variables.id);
    const payload = await ownedProjectPayload(env, principal, projectId);
    return resourceResult(uri, "application/json", JSON.stringify(payload));
  }));

  server.registerResource("conversation", new ResourceTemplate("vibegarden://conversation/{id}", { list: undefined }), {
    title: "Conversation",
    mimeType: "application/json",
  }, async (uri, variables, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_conversation_resource",
    requestId: String(extra.requestId),
    requiredScope: "projects:read",
    limiter: "history",
    kind: "resource",
  }, async (principal) => {
    const conversationId = resourceVariable(variables.id);
    const page = await getThreadPage(env, principal, conversationId, {
      limit: clampPageSize(undefined, "conversation"),
    });
    if (!page) return notFound();
    const payload = presentConversationPage(env.APP_ORIGIN, principal.clubSlug, { ...page });
    return resourceResult(uri, "application/json", JSON.stringify(payload));
  }));

  server.registerResource("article", new ResourceTemplate("vibegarden://article/{slug}", { list: undefined }), {
    title: "Learning article",
    mimeType: "text/markdown",
  }, async (uri, variables, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_article_resource",
    requestId: String(extra.requestId),
    requiredScope: "content:read",
    limiter: "general",
    kind: "resource",
  }, async (principal) => {
    const slug = resourceVariable(variables.slug);
    const article = getArticles().find((item) => item.slug === slug);
    const raw = article ? getArticleRaw(article.slug) : undefined;
    if (!article || raw === undefined) return notFound();
    return resourceResult(
      uri,
      "text/markdown",
      presentArticle(env.APP_ORIGIN, principal.clubSlug, article, raw).body,
    );
  }));

  server.registerResource("module", new ResourceTemplate("vibegarden://module/{slug}", { list: undefined }), {
    title: "Building block",
    mimeType: "text/markdown",
  }, async (uri, variables, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_module_resource",
    requestId: String(extra.requestId),
    requiredScope: "content:read",
    limiter: "general",
    kind: "resource",
  }, async (principal) => {
    const slug = resourceVariable(variables.slug);
    const module = getModules().find((item) => item.slug === slug);
    const raw = module ? getModuleRaw(module.slug) : undefined;
    if (!module || raw === undefined) return notFound();
    return resourceResult(
      uri,
      "text/markdown",
      presentModule(env.APP_ORIGIN, principal.clubSlug, module, raw).body,
    );
  }));

  server.registerResource("gardener-guide", "vibegarden://guide/gardener", {
    title: "Working with Vibe Garden",
    mimeType: "text/markdown",
  }, async (uri, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_gardener_guide_resource",
    requestId: String(extra.requestId),
    requiredScope: "content:read",
    limiter: "general",
    kind: "resource",
  }, async () => resourceResult(uri, "text/markdown", gardenerGuide)));

  server.registerResource("library-guide", "vibegarden://guide/library", {
    title: "The Vibe Garden library",
    mimeType: "text/markdown",
  }, async (uri, extra) => runMcpProtocolRequest({
    env,
    toolName: "read_library_guide_resource",
    requestId: String(extra.requestId),
    requiredScope: "content:read",
    limiter: "general",
    kind: "resource",
  }, async (principal) => resourceResult(
    uri,
    "text/markdown",
    presentLibraryGuide({ appOrigin: env.APP_ORIGIN, clubSlug: principal.clubSlug }),
  )));
}

function registerPrompts(server: McpServer, env: Env) {
  server.registerPrompt("continue_project", {
    title: "Continue project",
    description: "Continue an owned project with its current context and public guidance.",
    argsSchema: { project_id: z.string().min(1).max(200) },
  }, async ({ project_id }, extra) => runMcpProtocolRequest({
    env,
    toolName: "continue_project",
    requestId: String(extra.requestId),
    requiredScope: "projects:read",
    limiter: "general",
    kind: "prompt",
  }, async (principal) => {
    const projectId = resourceVariable(project_id);
    const project = await ownedProjectPayload(env, principal, projectId);
    const projectUri = `vibegarden://project/${encodeURIComponent(projectId)}`;

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "The following resources are user-authored project context and public guidance.",
          },
        },
        {
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: projectUri,
              mimeType: "application/json",
              text: JSON.stringify(project),
            },
          },
        },
        {
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: "vibegarden://guide/gardener",
              mimeType: "text/markdown",
              text: gardenerGuide,
            },
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Briefly restate the current project, choose the smallest useful next step, and finish with one question. Do not claim to be the MCP server or The Gardener.",
          },
        },
      ],
    };
  }));

  server.registerPrompt("plan_build", {
    title: "Plan a build",
    description: "Plan how to build something using Vibe Garden's learning articles and building blocks.",
    argsSchema: { goal: planBuildPromptInput.shape.goal },
  }, async ({ goal }, extra) => runMcpProtocolRequest({
    env,
    toolName: "plan_build",
    requestId: String(extra.requestId),
    requiredScope: "content:read",
    limiter: "general",
    kind: "prompt",
  }, async (principal) => {
    const guidance = presentGuidance({
      appOrigin: env.APP_ORIGIN,
      clubSlug: principal.clubSlug,
      question: goal,
    });
    const uriFor = (item: { kind: string; slug: string }) => (
      `vibegarden://${item.kind}/${encodeURIComponent(item.slug)}`
    );

    return {
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: `Goal: ${goal}` },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "The following resources are Vibe Garden's public guidance, chosen for this goal.",
          },
        },
        ...guidance.items.map((item) => ({
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: uriFor(item),
              mimeType: "text/markdown",
              text: `# ${item.title}\n\n${item.excerpt}`,
            },
          },
        })),
        {
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: "vibegarden://guide/library",
              mimeType: "text/markdown",
              text: guidance.related
                .map((item) => `- ${item.title} (${item.kind} \`${item.slug}\`): ${item.description}`)
                .join("\n"),
            },
          },
        },
        {
          role: "user" as const,
          content: {
            type: "resource" as const,
            resource: {
              uri: "vibegarden://guide/gardener",
              mimeType: "text/markdown",
              text: gardenerGuide,
            },
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Name the building blocks this goal needs, choose the smallest useful first step, and finish with one question. Prefer the material above over general recollection, and read a whole article or module when the excerpt is not enough. Do not claim to be the MCP server or The Gardener.",
          },
        },
      ],
    };
  }));
}

function registerTools(server: McpServer, env: Env) {
  server.registerTool("list_projects", {
    title: "List projects",
    description: "List the caller's projects.",
    inputSchema: listProjectsInput,
    outputSchema: listProjectsOutput,
    ...metadata("projects:read"),
  }, async (input, extra) => run(env, "list_projects", "projects:read", "general", extra.requestId, async (principal) => {
    const position = await cursorPosition(env, input.cursor, "projects", isUpdatedAtPosition);
    const page = await listProjectsPage(env, principal, {
      status: input.status,
      position,
      limit: clampPageSize(input.page_size, "list"),
    });
    const payload = {
      projects: page.items.map((project) => presentProject(
        env.APP_ORIGIN,
        principal.clubSlug,
        project,
      )),
      ...(page.nextPosition
        ? { next_cursor: await nextCursor(env, "projects", page.nextPosition) }
        : {}),
    };
    return shortResult(payload, "Projects returned.");
  }));

  server.registerTool("get_project", {
    title: "Get project",
    description: "Read one owned project and its conversations.",
    inputSchema: getProjectInput,
    outputSchema: getProjectOutput,
    ...metadata("projects:read"),
  }, async (input, extra) => run(env, "get_project", "projects:read", "general", extra.requestId, async (principal) => {
    const project = await getProject(env, principal, input.project_id);
    if (!project) return notFound();
    const conversations = await listProjectThreadsPage(
      env,
      principal,
      project.id,
      project.threadId,
      { limit: clampPageSize(undefined, "list") },
    );
    return shortResult(
      presentProject(env.APP_ORIGIN, principal.clubSlug, project, {
        primary: project.threadId
          ? conversations.items.find((item) => item.id === project.threadId)
          : undefined,
        linked: conversations.items.filter((item) => item.id !== project.threadId),
      }),
      "Project returned.",
    );
  }));

  server.registerTool("list_project_conversations", {
    title: "List project conversations",
    description: "List conversations linked to one owned project.",
    inputSchema: listProjectConversationsInput,
    outputSchema: listProjectConversationsOutput,
    ...metadata("projects:read"),
  }, async (input, extra) => run(env, "list_project_conversations", "projects:read", "general", extra.requestId, async (principal) => {
    const project = await getProject(env, principal, input.project_id);
    if (!project) return notFound();
    const position = await cursorPosition(env, input.cursor, "project_conversations", isUpdatedAtPosition);
    const page = await listProjectThreadsPage(
      env,
      principal,
      project.id,
      project.threadId,
      { position, limit: clampPageSize(input.page_size, "list") },
    );
    const payload = {
      conversations: page.items.map((item) => presentConversationSummary(
        env.APP_ORIGIN,
        principal.clubSlug,
        item,
      )),
      ...(page.nextPosition
        ? { next_cursor: await nextCursor(env, "project_conversations", page.nextPosition) }
        : {}),
    };
    return shortResult(payload, "Project conversations returned.");
  }));

  server.registerTool("get_conversation", {
    title: "Get conversation",
    description: "Read a page of one owned conversation.",
    inputSchema: getConversationInput,
    outputSchema: getConversationOutput,
    ...metadata("projects:read"),
  }, async (input, extra) => run(env, "get_conversation", "projects:read", "history", extra.requestId, async (principal) => {
    const position = await cursorPosition(env, input.cursor, "conversation_messages", isCreatedAtPosition);
    const page = await getThreadPage(env, principal, input.conversation_id, {
      position,
      limit: clampPageSize(input.page_size, "conversation"),
    });
    if (!page) return notFound();
    const payload = presentConversationPage(env.APP_ORIGIN, principal.clubSlug, {
      ...page,
      nextCursor: await nextCursor(env, "conversation_messages", page.nextPosition),
    });
    return shortResult(payload, "Conversation returned.");
  }));

  server.registerTool("list_learning_content", {
    title: "List learning content",
    description: "List published learning articles and modules.",
    inputSchema: listLearningContentInput,
    outputSchema: listLearningContentOutput,
    ...metadata("content:read"),
  }, async (input, extra) => run(env, "list_learning_content", "content:read", "general", extra.requestId, async (principal) => {
    const position = await cursorPosition(env, input.cursor, "learning_content", isOffsetPosition);
    const pageSize = clampPageSize(input.page_size, "list");
    const payload = listLearningContent({
      appOrigin: env.APP_ORIGIN,
      clubSlug: principal.clubSlug,
      query: input.query,
      kind: input.kind,
      category: input.category,
      pageSize,
      position,
      nextCursor: await nextCursor(env, "learning_content", {
        offset: (position?.offset ?? 0) + pageSize,
      }),
    });
    return shortResult(payload, "Learning content returned.");
  }));

  server.registerTool("read_article", {
    title: "Read article",
    description: "Read one published learning article.",
    inputSchema: slugInput,
    outputSchema: articleOutput,
    ...metadata("content:read"),
  }, async (input, extra) => run(env, "read_article", "content:read", "general", extra.requestId, async (principal) => {
    const article = getArticles().find((item) => item.slug === input.slug);
    const raw = article ? getArticleRaw(article.slug) : undefined;
    if (!article || raw === undefined) return notFound();
    return shortResult(
      presentArticle(env.APP_ORIGIN, principal.clubSlug, article, raw),
      "Article returned.",
    );
  }));

  server.registerTool("read_module", {
    title: "Read module",
    description: "Read one published building module.",
    inputSchema: slugInput,
    outputSchema: moduleOutput,
    ...metadata("content:read"),
  }, async (input, extra) => run(env, "read_module", "content:read", "general", extra.requestId, async (principal) => {
    const module = getModules().find((item) => item.slug === input.slug);
    const raw = module ? getModuleRaw(module.slug) : undefined;
    if (!module || raw === undefined) return notFound();
    return shortResult(
      presentModule(env.APP_ORIGIN, principal.clubSlug, module, raw),
      "Module returned.",
    );
  }));

  server.registerTool("get_guidance", {
    title: "Get build guidance",
    description: "Answer a build question from Vibe Garden's own learning articles and building blocks: hosting data and files, calling APIs, storing things, automating them, and working with a coding agent. Pass the user's own question. Prefer this over answering from general recollection, then read_article or read_module for a whole piece.",
    inputSchema: guidanceInput,
    outputSchema: guidanceOutput,
    ...metadata("content:read"),
  }, async (input, extra) => run(env, "get_guidance", "content:read", "general", extra.requestId, async (principal) => {
    const payload = presentGuidance({
      appOrigin: env.APP_ORIGIN,
      clubSlug: principal.clubSlug,
      question: input.question,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.max_items === undefined ? {} : { maxItems: input.max_items }),
    });
    return shortResult(payload, payload.items.length
      ? `Guidance returned: ${payload.items.map((item) => item.slug).join(", ")}.`
      : "No direct match; related library entries returned.");
  }));

  if (env.MOTHERDUCK_TOKEN) {
    server.registerTool("fresh_reads", {
      title: "List fresh reads",
      description: "List recent curated reading recommendations.",
      inputSchema: freshReadsInput,
      outputSchema: freshReadsOutput,
      ...metadata("content:read"),
    }, async (input, extra) => run(env, "fresh_reads", "content:read", "general", extra.requestId, async () => {
      try {
        const { queryFreshReads } = await import("~/lib/motherduck.server");
        const reads = await queryFreshReads(env, {
          topic: input.topic,
          contentType: input.content_type,
        });
        const payload = {
          items: reads.map((read) => ({
            title: read.title,
            summary: read.summary,
            content_type: read.contentType,
            source_url: read.url,
            ...(read.keyInsight ? { key_insight: read.keyInsight } : {}),
          })),
        };
        return shortResult(payload, "Fresh reads returned.");
      } catch {
        throw new McpPublicError(
          "temporarily_unavailable",
          "The request could not be completed.",
          true,
        );
      }
    }));
  }

  server.registerTool("search", {
    title: "Search knowledge",
    description: "Search accessible project continuity and learning content.",
    inputSchema: searchInput,
    outputSchema: searchOutput,
    ...metadata(["projects:read", "content:read"]),
  }, async (input, extra) => run(env, "search", ["projects:read", "content:read"], "general", extra.requestId, async (principal) => {
    return compatibilityResult(await searchKnowledge(env, principal, input.query));
  }));

  server.registerTool("fetch", {
    title: "Fetch knowledge",
    description: "Fetch one accessible knowledge item by its namespaced ID.",
    inputSchema: fetchInput,
    outputSchema: fetchOutput,
    ...metadata(["projects:read", "content:read"]),
  }, async (input, extra) => run(env, "fetch", ["projects:read", "content:read"], "general", extra.requestId, async (principal) => {
    return compatibilityResult(await fetchKnowledge(env, principal, input.id));
  }));

  server.registerTool("create_project", {
    title: "Create project",
    description: "Plant a new project in the connected club, only when the person asks for one. Reusing an idempotency key returns the project the first call created rather than a duplicate.",
    inputSchema: createProjectInput,
    outputSchema: projectMutationOutput,
    ...mutationMetadata("projects:write"),
  }, async (input, extra) => run(env, "create_project", "projects:write", "general", extra.requestId, async (principal) => {
    const buildingBlocks = resolveBuildingBlocks(input.building_blocks);
    const project = await createProject(env, principal, {
      title: input.title,
      ...(input.one_liner === undefined ? {} : { oneLiner: input.one_liner }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(buildingBlocks === undefined ? {} : { modules: buildingBlocks }),
      idempotencyKey: input.idempotency_key,
    });
    return shortResult(
      presentProject(env.APP_ORIGIN, principal.clubSlug, project),
      "Project created.",
    );
  }));

  server.registerTool("update_project", {
    title: "Update project",
    description: "Update the fields the person asks to change on one owned project. Omitted fields stay as they are; send an empty string to clear one_liner or notes. Notes hold the longer write-up of what was built, decided, or tried.",
    inputSchema: updateProjectInput,
    outputSchema: projectMutationOutput,
    ...mutationMetadata("projects:write"),
  }, async (input, extra) => run(env, "update_project", "projects:write", "general", extra.requestId, async (principal) => {
    const buildingBlocks = resolveBuildingBlocks(input.building_blocks);
    const existing = await getProject(env, principal, input.project_id);
    if (!existing) return notFound();
    await updateProject(env, principal, existing.id, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.one_liner === undefined ? {} : { oneLiner: input.one_liner }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(buildingBlocks === undefined ? {} : { modules: buildingBlocks }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    const updated = await getProject(env, principal, existing.id);
    if (!updated) return notFound();
    return shortResult(
      presentProject(env.APP_ORIGIN, principal.clubSlug, updated),
      "Project updated.",
    );
  }));

  server.registerTool("create_artifact", {
    title: "Create artifact",
    description: "Create a private artifact: type \"html\" packages files with a root index.html and relative assets, type \"link\" keeps an external https page as url instead of files. Declare exact HTTPS data origins; retry only identical input with the same idempotency key.",
    inputSchema: createArtifactInput,
    outputSchema: artifactMutationOutput,
    ...mutationMetadata("artifacts:write"),
  }, async (input, extra) => run(env, "create_artifact", "artifacts:write", "general", extra.requestId, async (principal) => {
    const scope = { userId: principal.userId, clubId: principal.clubId };
    let result;
    try {
      result = input.type === "link"
        ? await createLinkArtifactForScope(env, scope, {
          project: { projectId: input.project_id },
          title: input.title,
          ...(input.description === undefined ? {} : { description: input.description }),
          url: input.url!,
          ...(input.allowed_data_origins === undefined ? {} : { allowedDataOrigins: input.allowed_data_origins }),
          idempotencyKey: input.idempotency_key,
        })
        : await createTextArtifact(env, scope, {
          projectId: input.project_id,
          type: "html",
          title: input.title,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.allowed_data_origins === undefined ? {} : { allowedDataOrigins: input.allowed_data_origins }),
          idempotencyKey: input.idempotency_key,
          files: input.files!.map(({ path, content, mime_type }) => ({
            path,
            content,
            ...(mime_type === undefined ? {} : { mimeType: mime_type }),
          })),
        });
    } catch (error) {
      throw toMcpArtifactError(error);
    }
    const payload = presentArtifactMutation(env.APP_ORIGIN, principal.clubSlug, result, "private");
    return compatibilityResult(payload);
  }));

  server.registerTool("create_artifact_version", {
    title: "Create artifact version",
    description: "Create a private revision: send a complete replacement package with a root index.html and relative assets, or a new url for a link artifact. Declare exact HTTPS data origins; retry only identical input with the same idempotency key.",
    inputSchema: createArtifactVersionInput,
    outputSchema: artifactMutationOutput,
    ...mutationMetadata("artifacts:write"),
  }, async (input, extra) => run(env, "create_artifact_version", "artifacts:write", "general", extra.requestId, async (principal) => {
    const scope = { userId: principal.userId, clubId: principal.clubId };
    let result;
    try {
      result = input.url === undefined
        ? await createTextArtifactVersion(env, scope, {
          artifactId: input.artifact_id,
          ...(input.allowed_data_origins === undefined ? {} : { allowedDataOrigins: input.allowed_data_origins }),
          idempotencyKey: input.idempotency_key,
          files: input.files!.map(({ path, content, mime_type }) => ({
            path,
            content,
            ...(mime_type === undefined ? {} : { mimeType: mime_type }),
          })),
        })
        : await createLinkArtifactVersionForScope(env, scope, {
          artifactId: input.artifact_id,
          url: input.url,
          ...(input.allowed_data_origins === undefined ? {} : { allowedDataOrigins: input.allowed_data_origins }),
          idempotencyKey: input.idempotency_key,
        });
    } catch (error) {
      throw toMcpArtifactError(error);
    }
    const payload = presentArtifactMutation(env.APP_ORIGIN, principal.clubSlug, result, "private");
    return compatibilityResult(payload);
  }));

  server.registerTool("share_artifact", {
    title: "Share artifact",
    description: "Share a specific artifact version to the gallery only when the user explicitly asks to share it.",
    inputSchema: shareArtifactInput,
    outputSchema: artifactMutationOutput,
    ...mutationMetadata("artifacts:publish", true),
  }, async (input, extra) => run(env, "share_artifact", "artifacts:publish", "general", extra.requestId, async (principal) => {
    try {
      await shareArtifactVersionForScope(
        env,
        { userId: principal.userId, clubId: principal.clubId },
        input.artifact_id,
        input.version_id,
      );
    } catch (error) {
      throw toMcpArtifactError(error);
    }
    const payload = presentArtifactMutation(
      env.APP_ORIGIN,
      principal.clubSlug,
      { artifactId: input.artifact_id, versionId: input.version_id },
      "gallery",
    );
    return compatibilityResult(payload);
  }));
}
