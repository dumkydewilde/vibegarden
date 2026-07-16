import { describe, expect, it } from "vitest";
import { listAdminThreads } from "~/lib/threads.server";

describe("listAdminThreads", () => {
  it("queries only non-empty participant conversations, newest first", async () => {
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
    expect(sql).toMatch(/where "users"\."role" = \?/i);
    expect(bindings).toEqual(["user"]);
    expect(sql).toMatch(/count\("chat_messages"\."id"\)/i);
    expect(sql).toMatch(
      /group by "chat_threads"\."id", "users"\."id"/i,
    );
    expect(sql).toMatch(/order by "chat_threads"\."updated_at" desc/i);
  });
});
