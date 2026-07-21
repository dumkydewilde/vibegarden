import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@duckdb/duckdb-wasm", () => ({
  getJsDelivrBundles: () => ({}),
  selectBundle: async () => ({
    mainWorker: "duckdb-worker.js",
    mainModule: "duckdb.wasm",
  }),
  VoidLogger: class VoidLogger {},
  AsyncDuckDB: class AsyncDuckDB {
    async instantiate() {}
    async connect() {
      return { send: mocks.send };
    }
  },
}));

import { runQuery } from "../duckdb.client";

describe("runQuery", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", class Worker {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:duckdb-worker");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const rows = [
      ["Espresso", 12],
      ["Latte", 18],
      ["Mocha", 9],
    ];
    mocks.send.mockReturnValue(
      (async function* () {
        yield {
          schema: {
            fields: [
              { name: "drink", type: { typeId: 5 } },
              { name: "sales", type: { typeId: 2 } },
            ],
          },
          numRows: rows.length,
          getChildAt: (column: number) => ({
            get: (row: number) => rows[row][column],
          }),
        };
      })(),
    );
  });

  it("runs standalone SQL when no dataset is registered", async () => {
    const result = await runQuery(
      "SELECT * FROM (VALUES ('Espresso', 12), ('Latte', 18), ('Mocha', 9)) sales(drink, sales)",
    );

    expect(result).toEqual({
      status: "ok",
      columns: ["drink", "sales"],
      rows: [
        ["Espresso", 12],
        ["Latte", 18],
        ["Mocha", 9],
      ],
      rowCount: 3,
      truncated: false,
    });
  });
});
