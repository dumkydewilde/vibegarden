/**
 * Shared logic for the query_data tool: the model writes DuckDB SQL, the
 * person's browser runs it (DuckDB-WASM), and a capped result envelope
 * travels back for a narration turn. Pure functions only, so both the
 * worker and the browser can use them and vitest can cover them.
 */

export type ChartType = "line" | "scatter" | "bar";

export type ChartSpec = {
  type: ChartType;
  /** Column name for the x axis. */
  x: string;
  /** Column name for the y axis (must be numeric). */
  y: string;
  title?: string;
};

export type QueryRequest = {
  sql: string;
  chart?: ChartSpec;
};

export type Cell = string | number | boolean | null;

export type QueryResultEnvelope =
  | {
      status: "ok";
      columns: string[];
      rows: Cell[][];
      /** Total rows the query produced, before capping. */
      rowCount: number;
      truncated: boolean;
    }
  | { status: "error"; error: string };

export const QUERY_SQL_MAX_CHARS = 4_000;
export const RESULT_MAX_ROWS = 50;
export const RESULT_MAX_CHARS = 4_000;
export const MAX_CONTINUATIONS = 3;
export const MAX_DATASETS = 5;
export const DATASET_SUMMARY_MAX_CHARS = 2_000;

const CHART_TYPES: ChartType[] = ["line", "scatter", "bar"];

/** A chart spec from model arguments; invalid shapes become undefined. */
export function parseChartSpec(raw: unknown): ChartSpec | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const spec = raw as Record<string, unknown>;
  if (
    !CHART_TYPES.includes(spec.type as ChartType) ||
    typeof spec.x !== "string" ||
    !spec.x.trim() ||
    typeof spec.y !== "string" ||
    !spec.y.trim()
  ) {
    return undefined;
  }
  return {
    type: spec.type as ChartType,
    x: spec.x.trim(),
    y: spec.y.trim(),
    ...(typeof spec.title === "string" && spec.title.trim()
      ? { title: spec.title.trim().slice(0, 120) }
      : {}),
  };
}

/** Model arguments for query_data; returns an error string when unusable. */
export function parseQueryRequest(
  args: Record<string, unknown>,
): { value: QueryRequest; error?: never } | { value?: never; error: string } {
  if (typeof args.sql !== "string" || !args.sql.trim()) {
    return { error: "Error: sql is required." };
  }
  const sql = args.sql.trim();
  if (sql.length > QUERY_SQL_MAX_CHARS) {
    return {
      error: `Error: sql must be ${QUERY_SQL_MAX_CHARS} characters or fewer.`,
    };
  }
  return { value: { sql, chart: parseChartSpec(args.chart) } };
}

/** Make any value JSON- and prose-safe: numbers stay numbers, rest strings. */
export function normalizeCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 200);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Cap a result to RESULT_MAX_ROWS and RESULT_MAX_CHARS so envelopes stay
 * cheap in the follow-up request and in stored history.
 */
export function capResult(
  columns: string[],
  rows: Cell[][],
  totalRows = rows.length,
): Extract<QueryResultEnvelope, { status: "ok" }> {
  let kept = rows.slice(0, RESULT_MAX_ROWS);
  let size = JSON.stringify(kept).length;
  while (kept.length > 1 && size > RESULT_MAX_CHARS) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)));
    size = JSON.stringify(kept).length;
  }
  return {
    status: "ok",
    columns,
    rows: kept,
    rowCount: totalRows,
    truncated: kept.length < totalRows,
  };
}

/** Parse an envelope defensively (it crosses the client/server boundary). */
export function parseEnvelope(raw: string): QueryResultEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<QueryResultEnvelope>;
    if (parsed.status === "error") {
      return typeof parsed.error === "string"
        ? { status: "error", error: parsed.error.slice(0, 1_000) }
        : null;
    }
    if (
      parsed.status === "ok" &&
      Array.isArray(parsed.columns) &&
      parsed.columns.every((c) => typeof c === "string") &&
      Array.isArray(parsed.rows) &&
      typeof parsed.rowCount === "number"
    ) {
      return capResult(
        parsed.columns,
        parsed.rows.map((row) =>
          Array.isArray(row) ? row.map(normalizeCell) : [],
        ),
        parsed.rowCount,
      );
    }
    return null;
  } catch {
    return null;
  }
}

/** One line summarizing an envelope, for model-bound history compaction. */
export function envelopeSummaryLine(envelope: QueryResultEnvelope): string {
  if (envelope.status === "error") {
    return `[query result: error: ${envelope.error.slice(0, 200)}]`;
  }
  return `[query result: ok, ${envelope.rowCount} rows, columns: ${envelope.columns.join(", ")}]`;
}

export type DatasetColumn = { name: string; type: string };

export type DatasetInfo = {
  /** DuckDB view name the model queries, e.g. "employees". */
  name: string;
  /** Human label: file name or URL. */
  label: string;
  columns: DatasetColumn[];
  rowCount: number;
  sampleRows: Cell[][];
  /** For link-sourced datasets: the URL, so the same link is not re-added. */
  sourceUrl?: string;
};

/** Data-file extensions we recognize in pasted text (excludes .txt). */
const DATA_URL_RE =
  /https?:\/\/[^\s<>"')]+\.(?:csv|tsv|json|jsonl|ndjson|parquet|pq|xlsx|xls)(?:\?[^\s<>"')]*)?/gi;

/**
 * Pull data-file links out of a chat message so they can be attached and
 * queried without the tools menu. Deduped, in first-seen order. Trailing
 * punctuation the URL regex greedily grabbed is trimmed.
 */
export function extractDataUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(DATA_URL_RE)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    if (!seen.has(url)) seen.add(url);
  }
  return [...seen];
}

/**
 * Remove data-file links from a message once they are attached as datasets,
 * so the model queries the dataset instead of fetching the raw file. Cleans
 * up leftover whitespace and dangling "this:" style lead-ins.
 */
export function stripDataUrls(text: string): string {
  return text
    .replace(DATA_URL_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** The schema block the model sees for one attached dataset. */
export function datasetSummary(info: DatasetInfo): string {
  const cols = info.columns
    .map((c) => `${c.name} (${c.type})`)
    .join(", ");
  const sample = info.sampleRows
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "))
    .join("\n");
  return [
    `Table "${info.name}" (${info.rowCount} rows, from ${info.label})`,
    `Columns: ${cols}`,
    sample ? `First rows:\n${sample}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, DATASET_SUMMARY_MAX_CHARS);
}

/** Turn a file or URL basename into a safe, unique DuckDB view name. */
export function tableNameFor(label: string, taken: Set<string>): string {
  const base =
    label
      .split("/")
      .pop()!
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "t$1") || "data";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}
