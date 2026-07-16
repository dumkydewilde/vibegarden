import { describe, expect, it } from "vitest";
import { getAdminThread, listAdminThreads } from "~/lib/threads.server";

describe("listAdminThreads", () => {
  it("queries non-empty conversations from every account, newest first", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const d1 = {
      prepare(statement: string) {
        sql = statement;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return { raw: async () => [] };
          },
        };
      },
    };

    await listAdminThreads({ DB: d1 } as Env);

    expect(sql).toMatch(/inner join "users"/i);
    expect(sql).toMatch(/inner join "chat_messages"/i);
    expect(sql).not.toMatch(/(?:where|and) "users"\."role"/i);
    expect(bindings).toEqual([]);
    expect(sql).toMatch(/count\("chat_messages"\."id"\)/i);
    expect(sql).toMatch(
      /group by "chat_threads"\."id", "users"\."id"/i,
    );
    expect(sql).toMatch(/order by "chat_threads"\."updated_at" desc/i);
  });

  it("allows an admin-owned transcript to be found after authorization", async () => {
    let sql = "";
    const d1 = {
      prepare(statement: string) {
        sql = statement;
        return {
          bind() {
            return { raw: async () => [] };
          },
        };
      },
    };

    await expect(getAdminThread({ DB: d1 } as Env, "thread-1")).resolves.toBeNull();

    expect(sql).toMatch(/where \(?"chat_threads"\."id" = \?/i);
    expect(sql).not.toMatch(/(?:where|and) "users"\."role"/i);
  });
});
