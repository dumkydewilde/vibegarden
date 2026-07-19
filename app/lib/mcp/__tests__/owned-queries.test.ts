import { beforeEach, describe, expect, it } from "vitest";
import {
  listProjectsPage,
  searchOwnedProjects,
} from "~/lib/projects.server";
import {
  getThreadPage,
  listProjectThreadsPage,
  searchOwnedThreads,
} from "~/lib/threads.server";

type ProjectRow = [
  id: string,
  userId: string,
  clubId: string,
  title: string,
  oneLiner: string | null,
  modules: string | null,
  status: "seed" | "growing" | "bloomed",
  threadId: string | null,
  createdAt: number,
  updatedAt: number,
];

let recordedBindings: unknown[][];
let projectRows: ProjectRow[];
let messageSelectCount: number;

function seedProjects(count: number) {
  projectRows = Array.from({ length: count }, (_, index) => {
    const sequence = count - index;
    return [
      `project-${sequence}`,
      "user-a",
      "club-a",
      `Project ${sequence}`,
      null,
      "[]",
      "seed",
      null,
      sequence,
      sequence,
    ];
  });
}

function seedThread(input: { id: string; userId: string; clubId?: string }) {
  return [input.id, input.userId, input.clubId ?? "club-a", "Thread", null, 1, 2];
}

function makeEnv(thread = seedThread({ id: "thread-a", userId: "user-a" })) {
  const d1 = {
    prepare(statement: string) {
      return {
        bind(...bindings: unknown[]) {
          recordedBindings.push(bindings);
          return {
            raw: async () => {
              if (statement.includes('from "projects"')) return projectRows;
              if (statement.includes('from "chat_messages"')) {
                messageSelectCount += 1;
                return [];
              }
              if (statement.includes('from "chat_threads"')) {
                return bindings.includes(thread[0]) && bindings.includes(thread[1])
                  ? [thread]
                  : [];
              }
              return [];
            },
          };
        },
      };
    },
  };
  return { DB: d1 } as unknown as Env;
}

beforeEach(() => {
  recordedBindings = [];
  projectRows = [];
  messageSelectCount = 0;
});

describe("owned MCP D1 queries", () => {
  it("binds clubId and userId into project, thread, and message queries", async () => {
    const env = makeEnv();
    const scope = { clubId: "club-a", userId: "user-a" };

    await listProjectsPage(env, scope, { limit: 20 });
    await listProjectThreadsPage(env, scope, "project-a", null, { limit: 20 });
    await getThreadPage(env, scope, "thread-a", { limit: 50 });

    expect(recordedBindings).not.toHaveLength(0);
    expect(recordedBindings.every((bindings) => bindings.includes("user-a"))).toBe(true);
    expect(recordedBindings.every((bindings) => bindings.includes("club-a"))).toBe(true);
  });

  it("uses the last visible item as the next keyset position", async () => {
    seedProjects(21);

    const page = await listProjectsPage(makeEnv(), { clubId: "club-a", userId: "user-a" }, { limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(page.nextPosition).toEqual({
      updatedAt: page.items[19].updatedAt,
      id: page.items[19].id,
    });
  });

  it("returns null for a foreign conversation before selecting messages", async () => {
    const env = makeEnv(seedThread({ id: "thread-b", userId: "user-b" }));

    await expect(getThreadPage(env, { clubId: "club-a", userId: "user-a" }, "thread-b", { limit: 50 })).resolves.toBeNull();

    expect(messageSelectCount).toBe(0);
  });

  it("caps owned project searches and binds the requesting user", async () => {
    await searchOwnedProjects(makeEnv(), { clubId: "club-a", userId: "user-a" }, "project", 100);

    expect(recordedBindings.flat()).toContain("user-a");
    expect(recordedBindings.flat()).toContain("club-a");
    expect(recordedBindings.flat()).toContain(20);
  });

  it("caps owned thread searches and binds the requesting user", async () => {
    await searchOwnedThreads(makeEnv(), { clubId: "club-a", userId: "user-a" }, "thread", 100);

    expect(recordedBindings.flat()).toContain("user-a");
    expect(recordedBindings.flat()).toContain("club-a");
    expect(recordedBindings.flat()).toContain(20);
  });

  it.each([
    ["percent", "%", "%\\%%"],
    ["underscore", "_", "%\\_%"],
    ["backslash", "\\", "%\\\\%"],
  ])(
    "binds a single SQLite escape for a literal %s search",
    async (_name, query, expectedTerm) => {
      const env = makeEnv();

      await searchOwnedProjects(env, "user-a", query, 20);
      await searchOwnedThreads(env, "user-a", query, 20);

      expect(recordedBindings.flat().filter((binding) => binding === expectedTerm)).toHaveLength(4);
    },
  );
});
