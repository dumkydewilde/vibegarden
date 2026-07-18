import { describe, expect, it, vi } from "vitest";
import { fetchKnowledge, parseKnowledgeId, searchKnowledge } from "~/lib/mcp/compatibility.server";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getThreadPage: vi.fn(),
  listProjectThreadsPage: vi.fn(),
  searchOwnedProjects: vi.fn(),
  searchOwnedThreads: vi.fn(),
}));

vi.mock("~/lib/content", () => ({
  getArticles: () => [{
    slug: "what-is-mcp",
    title: "What is MCP?",
    description: "MCP basics",
    category: "Foundations",
    level: "starter" as const,
    order: 1,
  }],
  getArticleRaw: () => "---\ntitle: Private frontmatter\n---\nMCP garden guide",
}));

vi.mock("~/lib/modules", () => ({
  getModules: () => [],
  getModuleRaw: () => undefined,
}));

vi.mock("~/lib/projects.server", () => ({
  getProject: mocks.getProject,
  searchOwnedProjects: mocks.searchOwnedProjects,
}));

vi.mock("~/lib/threads.server", () => ({
  getThreadPage: mocks.getThreadPage,
  listProjectThreadsPage: mocks.listProjectThreadsPage,
  searchOwnedThreads: mocks.searchOwnedThreads,
  parseContext: vi.fn(),
}));

const env = { APP_ORIGIN: "https://vibegarden.test" } as Env;
const privatePrincipal = { userId: "user-a", scopes: ["projects:read"] as const };
const contentPrincipal = { userId: "user-a", scopes: ["content:read"] as const };
const combinedPrincipal = {
  userId: "user-a",
  scopes: ["projects:read", "content:read"] as const,
};

describe("MCP compatibility tools", () => {
  it("returns stable namespaced IDs and openable URLs", async () => {
    mocks.searchOwnedProjects.mockResolvedValue([{
      id: "project-1",
      title: "MCP garden map",
      oneLiner: null,
      modules: "[]",
      status: "seed",
      threadId: null,
      createdAt: 1,
      updatedAt: 2,
      userId: "user-a",
    }]);
    mocks.searchOwnedThreads.mockResolvedValue([]);

    const payload = await searchKnowledge(env, combinedPrincipal, "mcp");

    expect(payload.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "project:project-1",
        title: "MCP garden map",
        url: "https://vibegarden.test/garden/projects/project-1",
      }),
      expect.objectContaining({
        id: "article:what-is-mcp",
        url: expect.stringMatching(/^https:\/\//),
      }),
    ]));
    for (const result of payload.results) {
      expect(Object.keys(result).sort()).toEqual(["id", "title", "url"]);
    }
    expect(JSON.stringify(payload)).not.toContain("user-a");
  });

  it("uses scoped owned queries with source and total limits", async () => {
    mocks.searchOwnedProjects.mockResolvedValue([]);
    mocks.searchOwnedThreads.mockResolvedValue([]);

    await searchKnowledge(env, privatePrincipal, "garden");

    expect(mocks.searchOwnedProjects).toHaveBeenCalledWith(env, "user-a", "garden", 10);
    expect(mocks.searchOwnedThreads).toHaveBeenCalledWith(env, "user-a", "garden", 10);
  });

  it("makes foreign private IDs indistinguishable from missing IDs", async () => {
    mocks.getProject.mockResolvedValue(null);

    await expect(fetchKnowledge(env, privatePrincipal, "project:private-project"))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(fetchKnowledge(env, privatePrincipal, "project:missing"))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("fetches owned private records through public presenters", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1",
      title: "Garden map",
      oneLiner: "Private summary",
      modules: "[]",
      moduleList: [],
      status: "seed",
      threadId: "thread-1",
      createdAt: 1,
      updatedAt: 2,
      userId: "user-a",
    });
    mocks.listProjectThreadsPage.mockResolvedValue({
      items: [{ id: "thread-1", title: "Planning", updatedAt: 2, messageCount: 1 }],
    });
    mocks.getThreadPage.mockResolvedValue({
      thread: { id: "thread-1", title: "Planning", createdAt: 1, updatedAt: 2 },
      messages: [{ id: "message-1", role: "user", content: "Garden notes", context: null, createdAt: 3 }],
    });

    const project = await fetchKnowledge(env, privatePrincipal, "project:project-1");
    const conversation = await fetchKnowledge(env, privatePrincipal, "conversation:thread-1");

    expect(mocks.listProjectThreadsPage).toHaveBeenCalledWith(
      env,
      "user-a",
      "project-1",
      "thread-1",
      { limit: 50 },
    );
    expect(mocks.getThreadPage).toHaveBeenCalledWith(env, "user-a", "thread-1", { limit: 50 });
    expect(project).toMatchObject({
      id: "project:project-1",
      title: "Garden map",
      url: "https://vibegarden.test/garden/projects/project-1",
    });
    expect(conversation).toMatchObject({
      id: "conversation:thread-1",
      title: "Planning",
      url: "https://vibegarden.test/garden/conversations/thread-1",
    });
    expect(JSON.stringify([project, conversation])).not.toContain("user-a");
  });

  it("rejects unknown and malformed namespaces", async () => {
    for (const id of ["user:user-a", "project:", "project:too:many"]) {
      try {
        parseKnowledgeId(id);
        throw new Error("Expected invalid input error");
      } catch (error) {
        expect(error).toMatchObject({ code: "invalid_input" });
      }
    }
  });

  it("requires the matching scope before fetching a content item", async () => {
    await expect(fetchKnowledge(env, privatePrincipal, "article:what-is-mcp"))
      .rejects.toMatchObject({ code: "insufficient_scope" });

    const payload = await fetchKnowledge(env, contentPrincipal, "article:what-is-mcp");
    expect(payload).toMatchObject({
      id: "article:what-is-mcp",
      title: "What is MCP?",
      text: expect.any(String),
      url: "https://vibegarden.test/learning/what-is-mcp",
    });
    expect(payload.text).not.toMatch(/^---/);
  });

  it("emits an OpenAI-compatible structured and text result from one payload", async () => {
    mocks.searchOwnedProjects.mockResolvedValue([]);
    mocks.searchOwnedThreads.mockResolvedValue([]);

    const payload = await searchKnowledge(env, combinedPrincipal, "garden");

    expect({
      structuredContent: payload,
      content: [{ type: "text", text: JSON.stringify(payload) }],
    }).toEqual(expect.objectContaining({
      structuredContent: { results: expect.any(Array) },
      content: [{ type: "text", text: expect.any(String) }],
    }));
  });
});
