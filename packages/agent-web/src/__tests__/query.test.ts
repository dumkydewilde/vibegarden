import { describe, expect, it } from "vitest";
import {
  capResult,
  datasetSummary,
  envelopeSummaryLine,
  extractDataUrls,
  normalizeCell,
  stripDataUrls,
  parseChartSpec,
  parseEnvelope,
  parseQueryRequest,
  RESULT_MAX_ROWS,
  tableNameFor,
  type QueryResultEnvelope,
  queryNote,
  queryResultNote,
  splitToolNotes,
  stripToolEcho,
  toModelText,
  toolNote,
} from "@vibegarden/agent-web";

describe("parseQueryRequest", () => {
  it("accepts sql and a valid chart", () => {
    const parsed = parseQueryRequest({
      sql: "SELECT 1",
      chart: { type: "line", x: "year", y: "hires", title: "Hires" },
    });
    expect(parsed.value).toEqual({
      sql: "SELECT 1",
      chart: { type: "line", x: "year", y: "hires", title: "Hires" },
    });
  });

  it("rejects missing sql and drops invalid charts silently", () => {
    expect(parseQueryRequest({}).error).toMatch(/sql is required/);
    const parsed = parseQueryRequest({
      sql: "SELECT 1",
      chart: { type: "pie", x: "a", y: "b" },
    });
    expect(parsed.value?.chart).toBeUndefined();
  });
});

describe("parseChartSpec", () => {
  it("requires type, x, and y", () => {
    expect(parseChartSpec({ type: "bar", x: "a" })).toBeUndefined();
    expect(parseChartSpec({ type: "bar", x: "a", y: "b" })).toEqual({
      type: "bar",
      x: "a",
      y: "b",
    });
  });
});

describe("normalizeCell", () => {
  it("keeps numbers, maps bigint and dates, stringifies objects", () => {
    expect(normalizeCell(42)).toBe(42);
    expect(normalizeCell(BigInt(7))).toBe(7);
    expect(normalizeCell(BigInt("99999999999999999999"))).toBe(
      "99999999999999999999",
    );
    expect(normalizeCell(new Date("2021-06-01T12:00:00Z"))).toBe("2021-06-01");
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(NaN)).toBeNull();
  });
});

describe("capResult", () => {
  it("caps rows and flags truncation with the true total", () => {
    const rows = Array.from({ length: 200 }, (_, i) => [i]);
    const capped = capResult(["n"], rows, 5000);
    expect(capped.rows).toHaveLength(RESULT_MAX_ROWS);
    expect(capped.rowCount).toBe(5000);
    expect(capped.truncated).toBe(true);
  });

  it("halves oversized rows until the char budget fits", () => {
    const wide = Array.from({ length: 50 }, () => ["x".repeat(500)]);
    const capped = capResult(["blob"], wide);
    expect(JSON.stringify(capped.rows).length).toBeLessThanOrEqual(4_000);
    expect(capped.truncated).toBe(true);
  });

  it("leaves small results alone", () => {
    const capped = capResult(["a"], [[1], [2]]);
    expect(capped).toMatchObject({
      rows: [[1], [2]],
      rowCount: 2,
      truncated: false,
    });
  });
});

describe("parseEnvelope", () => {
  it("round-trips and re-caps an ok envelope", () => {
    const envelope = capResult(["a"], [[1]]);
    expect(parseEnvelope(JSON.stringify(envelope))).toEqual(envelope);
  });

  it("rejects garbage and malformed envelopes", () => {
    expect(parseEnvelope("not json")).toBeNull();
    expect(parseEnvelope(JSON.stringify({ status: "ok" }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ status: "error" }))).toBeNull();
  });

  it("re-caps oversized client payloads", () => {
    const huge = {
      status: "ok",
      columns: ["n"],
      rows: Array.from({ length: 5000 }, (_, i) => [i]),
      rowCount: 5000,
      truncated: false,
    };
    const parsed = parseEnvelope(JSON.stringify(huge));
    expect(parsed?.status).toBe("ok");
    if (parsed?.status === "ok") {
      expect(parsed.rows.length).toBeLessThanOrEqual(RESULT_MAX_ROWS);
      expect(parsed.truncated).toBe(true);
    }
  });
});

describe("query markers", () => {
  const query = {
    sql: "SELECT year(hire_date) AS y, count(*) AS n FROM employees GROUP BY 1",
    chart: { type: "line" as const, x: "y", y: "n" },
  };

  it("round-trips a query and its result through the stream format", () => {
    const envelope = capResult(["y", "n"], [[2020, 12]]);
    const text = `Let me look.\n\n${queryNote(query)}\n\n${queryResultNote(envelope)}\n\nDone.`;
    expect(splitToolNotes(text)).toEqual([
      { type: "text", text: "Let me look." },
      { type: "query", sql: query.sql, chart: query.chart },
      { type: "queryresult", result: envelope },
      { type: "text", text: "Done." },
    ]);
  });

  it("keeps malformed query markers as text", () => {
    expect(splitToolNotes("[[tool:query:not-json]]")).toEqual([
      { type: "text", text: "[[tool:query:not-json]]" },
    ]);
  });
});

describe("toModelText", () => {
  it("compacts query pairs to one-liners and drops activity notes", () => {
    const envelope = capResult(["y", "n"], [[2020, 12]], 30);
    const text = [
      "Looking now.",
      toolNote("article", "what-is-an-llm"),
      queryNote({ sql: "SELECT   1\nFROM t" }),
      queryResultNote(envelope),
      "The answer is 12.",
    ].join("\n\n");
    expect(toModelText(text)).toBe(
      [
        "Looking now.",
        "[ran query_data: SELECT 1 FROM t]",
        "[query result: ok, 30 rows, columns: y, n]",
        "The answer is 12.",
      ].join("\n\n"),
    );
  });

  it("strips parroted tool echoes from narration but keeps real markers", () => {
    expect(
      stripToolEcho(
        "Sales peaked in May.\n\n[ran query_data: SELECT * FROM t]\n\n[query result: ok, 5 rows]",
      ),
    ).toBe("Sales peaked in May.");
    expect(stripToolEcho('chart={"type":"line","x":"a","y":"b"}')).toBe("");
    // Real double-bracket markers are untouched.
    expect(stripToolEcho("[[tool:query:abc]]")).toBe("[[tool:query:abc]]");
  });

  it("summarizes error envelopes", () => {
    const err: QueryResultEnvelope = {
      status: "error",
      error: "Binder Error: no such column",
    };
    expect(envelopeSummaryLine(err)).toBe(
      "[query result: error: Binder Error: no such column]",
    );
  });
});

describe("extractDataUrls", () => {
  it("pulls data-file links out of a message, deduped", () => {
    const text =
      "what's up with https://x.com/wine.csv and https://x.com/wine.csv?";
    expect(extractDataUrls(text)).toEqual(["https://x.com/wine.csv"]);
  });

  it("recognizes the known formats and a query string", () => {
    expect(
      extractDataUrls(
        "https://a.co/d.parquet https://b.co/e.json https://c.co/f.xlsx https://d.co/g.csv?raw=1",
      ),
    ).toEqual([
      "https://a.co/d.parquet",
      "https://b.co/e.json",
      "https://c.co/f.xlsx",
      "https://d.co/g.csv?raw=1",
    ]);
  });

  it("ignores non-data links and trailing punctuation", () => {
    expect(extractDataUrls("see https://example.com/page and nothing")).toEqual(
      [],
    );
    expect(extractDataUrls("data at (https://x.com/a.csv).")).toEqual([
      "https://x.com/a.csv",
    ]);
  });

  it("strips data links from a message, tidying whitespace", () => {
    expect(
      stripDataUrls(
        "what's up with https://x.com/wine.csv ?",
      ),
    ).toBe("what's up with?");
    expect(stripDataUrls("https://x.com/data.parquet")).toBe("");
  });
});

describe("dataset helpers", () => {
  it("builds safe unique table names", () => {
    const taken = new Set<string>();
    expect(tableNameFor("employees.csv", taken)).toBe("employees");
    taken.add("employees");
    expect(tableNameFor("Employees (2).CSV", taken)).toBe("employees_2");
    expect(tableNameFor("2024-sales.parquet", taken)).toBe("t2024_sales");
    expect(tableNameFor("???.csv", taken)).toBe("data");
  });

  it("summarizes a dataset for the system prompt", () => {
    const summary = datasetSummary({
      name: "employees",
      label: "employees.csv",
      columns: [
        { name: "id", type: "BIGINT" },
        { name: "hire_date", type: "DATE" },
      ],
      rowCount: 107,
      sampleRows: [[198, "1987-06-17"]],
    });
    expect(summary).toContain('Table "employees" (107 rows');
    expect(summary).toContain("id (BIGINT), hire_date (DATE)");
    expect(summary).toContain("198 | 1987-06-17");
  });
});
