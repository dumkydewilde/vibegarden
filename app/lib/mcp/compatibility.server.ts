import { getArticles, getArticleRaw } from "~/lib/content";
import { BODY_MAX_CHARS, CONVERSATION_PAGE_DEFAULT, type McpPrincipal } from "~/lib/mcp/contracts";
import { presentArticle, presentModule } from "~/lib/mcp/content-presenter";
import { McpPublicError } from "~/lib/mcp/errors.server";
import {
  presentConversationPage,
  presentProject,
} from "~/lib/mcp/project-presenter.server";
import { getModules, getModuleRaw } from "~/lib/modules";
import { getProject, searchOwnedProjects } from "~/lib/projects.server";
import { listProjectThreadsPage, getThreadPage, searchOwnedThreads } from "~/lib/threads.server";
import { stripFrontmatter } from "~/lib/markdown";

type KnowledgeKind = "project" | "conversation" | "article" | "module";

export type SearchPayload = {
  results: Array<{ id: string; title: string; url: string }>;
};

export type FetchPayload = {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata?: Record<string, unknown>;
};

const ID_PATTERN = /^(project|conversation|article|module):([^:]{1,200})$/;

export function parseKnowledgeId(id: string) {
  const match = id.match(ID_PATTERN);
  if (!match) throw new McpPublicError("invalid_input", "The knowledge ID is invalid.");
  return { kind: match[1] as KnowledgeKind, value: match[2] };
}

function canonicalUrl(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}

function requireScope(principal: McpPrincipal, scope: McpPrincipal["scopes"][number]) {
  if (!principal.scopes.includes(scope)) {
    throw new McpPublicError("insufficient_scope", "The required scope is missing.");
  }
}

function searchTerm(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) throw new McpPublicError("invalid_input", "The search query is required.");
  return trimmed.slice(0, 200).toLowerCase();
}

function contentMatches(
  item: { title: string; description: string; category: string },
  raw: string | undefined,
  query: string,
): boolean {
  const body = raw === undefined ? "" : stripFrontmatter(raw).slice(0, BODY_MAX_CHARS);
  return [item.title, item.description, item.category, body]
    .join("\n")
    .toLowerCase()
    .includes(query);
}

export async function searchKnowledge(
  env: Env,
  principal: McpPrincipal,
  query: string,
): Promise<SearchPayload> {
  const term = searchTerm(query);
  const results: SearchPayload["results"] = [];

  if (principal.scopes.includes("projects:read")) {
    const [projects, conversations] = await Promise.all([
      searchOwnedProjects(env, principal.userId, term, 10),
      searchOwnedThreads(env, principal.userId, term, 10),
    ]);
    results.push(
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        title: project.title,
        url: canonicalUrl(env.APP_ORIGIN, `/garden/projects/${encodeURIComponent(project.id)}`),
      })),
      ...conversations.map((conversation) => ({
        id: `conversation:${conversation.id}`,
        title: conversation.title ?? "Untitled conversation",
        url: canonicalUrl(
          env.APP_ORIGIN,
          `/garden/conversations/${encodeURIComponent(conversation.id)}`,
        ),
      })),
    );
  }

  if (principal.scopes.includes("content:read")) {
    const articles = getArticles()
      .flatMap((article) => {
        const raw = getArticleRaw(article.slug);
        return raw !== undefined && contentMatches(article, raw, term) ? [article] : [];
      })
      .slice(0, 10)
      .map((article) => ({
        id: `article:${article.slug}`,
        title: article.title,
        url: canonicalUrl(env.APP_ORIGIN, `/learning/${encodeURIComponent(article.slug)}`),
      }));
    const modules = getModules()
      .flatMap((module) => {
        const raw = getModuleRaw(module.slug);
        return raw !== undefined && contentMatches(module, raw, term) ? [module] : [];
      })
      .slice(0, 10)
      .map((module) => ({
        id: `module:${module.slug}`,
        title: module.title,
        url: canonicalUrl(
          env.APP_ORIGIN,
          `/garden/modules/${encodeURIComponent(module.slug)}`,
        ),
      }));
    results.push(...articles, ...modules);
  }

  const seen = new Set<string>();
  return {
    results: results.filter((result) => {
      if (seen.has(result.id)) return false;
      seen.add(result.id);
      return true;
    }).slice(0, 20),
  };
}

export async function fetchKnowledge(
  env: Env,
  principal: McpPrincipal,
  id: string,
): Promise<FetchPayload> {
  const { kind, value } = parseKnowledgeId(id);

  if (kind === "project") {
    requireScope(principal, "projects:read");
    const project = await getProject(env, principal.userId, value);
    if (!project) throw new McpPublicError("not_found", "The knowledge item was not found.");

    const conversations = await listProjectThreadsPage(
      env,
      principal.userId,
      project.id,
      project.threadId,
      { limit: CONVERSATION_PAGE_DEFAULT },
    );
    const primary = project.threadId
      ? conversations.items.find((thread) => thread.id === project.threadId)
      : undefined;
    const linked = conversations.items.filter((thread) => thread.id !== project.threadId);
    const presented = presentProject(env.APP_ORIGIN, project, {
      primary,
      linked,
    });
    return {
      id,
      title: presented.title,
      text: JSON.stringify(presented),
      url: presented.url,
    };
  }

  if (kind === "conversation") {
    requireScope(principal, "projects:read");
    const page = await getThreadPage(env, principal.userId, value, {
      limit: CONVERSATION_PAGE_DEFAULT,
    });
    if (!page) throw new McpPublicError("not_found", "The knowledge item was not found.");

    const presented = presentConversationPage(env.APP_ORIGIN, page);
    return {
      id,
      title: page.thread.title ?? "Untitled conversation",
      text: JSON.stringify(presented),
      url: presented.conversation.url,
    };
  }

  requireScope(principal, "content:read");
  if (kind === "article") {
    const article = getArticles().find((item) => item.slug === value);
    const raw = article ? getArticleRaw(value) : undefined;
    if (!article || raw === undefined) {
      throw new McpPublicError("not_found", "The knowledge item was not found.");
    }
    const presented = presentArticle(env.APP_ORIGIN, article, raw);
    return {
      id,
      title: presented.title,
      text: presented.body,
      url: presented.url,
    };
  }

  const module = getModules().find((item) => item.slug === value);
  const raw = module ? getModuleRaw(value) : undefined;
  if (!module || raw === undefined) {
    throw new McpPublicError("not_found", "The knowledge item was not found.");
  }
  const presented = presentModule(env.APP_ORIGIN, module, raw);
  return {
    id,
    title: presented.title,
    text: presented.body,
    url: presented.url,
  };
}
