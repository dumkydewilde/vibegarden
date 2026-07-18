/**
 * DuckDB-WASM, browser-side only. The person's data files never leave the
 * machine: files and fetched links are registered as in-memory DuckDB
 * views, the Gardener writes SQL, and only a capped result envelope goes
 * back to the model. Everything is lazy-loaded on first attach, like the
 * Mermaid chunk.
 */

import {
  capResult,
  normalizeCell,
  RESULT_MAX_ROWS,
  tableNameFor,
  type Cell,
  type DatasetInfo,
  type QueryResultEnvelope,
} from "./query";

type DuckDBModule = typeof import("@duckdb/duckdb-wasm");
type AsyncDuckDB = import("@duckdb/duckdb-wasm").AsyncDuckDB;
type AsyncConnection = import("@duckdb/duckdb-wasm").AsyncDuckDBConnection;

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const SAMPLE_ROWS = 3;

let instance: Promise<{ db: AsyncDuckDB; conn: AsyncConnection }> | null =
  null;
const registered = new Map<string, DatasetInfo>();

async function boot() {
  const duckdb: DuckDBModule = await import("@duckdb/duckdb-wasm");
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "text/javascript",
    }),
  );
  try {
    const db = new duckdb.AsyncDuckDB(
      new duckdb.VoidLogger(),
      new Worker(workerUrl),
    );
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    return { db, conn };
  } finally {
    URL.revokeObjectURL(workerUrl);
  }
}

function getInstance() {
  if (!instance) {
    instance = boot().catch((e) => {
      instance = null; // A failed boot should not poison later attempts.
      throw e;
    });
  }
  return instance;
}

/** Datasets registered in this browser session. */
export function listDatasets(): DatasetInfo[] {
  return [...registered.values()];
}

type Format = "csv" | "json" | "parquet" | "xlsx";

function detectFormat(label: string): Format {
  const name = label.split("?")[0].toLowerCase();
  if (/\.(parquet|pq)$/.test(name)) return "parquet";
  if (/\.(json|jsonl|ndjson)$/.test(name)) return "json";
  if (/\.(xlsx|xls)$/.test(name)) return "xlsx";
  return "csv"; // csv, tsv, txt, and anything else read_csv_auto can sniff
}

function readerFor(format: Format, fileName: string): string {
  const quoted = `'${fileName}'`;
  if (format === "parquet") return `read_parquet(${quoted})`;
  if (format === "json") return `read_json_auto(${quoted})`;
  if (format === "xlsx") return `read_xlsx(${quoted})`;
  return `read_csv_auto(${quoted})`;
}

/** Arrow type ids that need date formatting (Date=8, Timestamp=10). */
const DATE_TYPE_IDS = new Set([8, 10]);

function cellFrom(value: unknown, typeId: number): Cell {
  if (value !== null && DATE_TYPE_IDS.has(typeId)) {
    const ms = typeof value === "bigint" ? Number(value) : (value as number);
    if (typeof ms === "number" && Number.isFinite(ms)) {
      return new Date(ms).toISOString().slice(0, typeId === 8 ? 10 : 19);
    }
  }
  return normalizeCell(value);
}

async function collectRows(
  conn: AsyncConnection,
  sql: string,
  maxRows: number,
): Promise<{ columns: string[]; rows: Cell[][]; rowCount: number }> {
  const reader = await conn.send(sql);
  let columns: string[] = [];
  let typeIds: number[] = [];
  const rows: Cell[][] = [];
  let rowCount = 0;
  for await (const batch of reader) {
    if (columns.length === 0) {
      columns = batch.schema.fields.map((f) => f.name);
      typeIds = batch.schema.fields.map((f) => f.type.typeId);
    }
    for (let i = 0; i < batch.numRows; i++) {
      rowCount++;
      if (rows.length >= maxRows) continue; // keep counting, stop storing
      const row: Cell[] = [];
      for (let c = 0; c < columns.length; c++) {
        row.push(cellFrom(batch.getChildAt(c)?.get(i), typeIds[c]));
      }
      rows.push(row);
    }
  }
  return { columns, rows, rowCount };
}

async function introspect(
  conn: AsyncConnection,
  name: string,
  label: string,
): Promise<DatasetInfo> {
  const describe = await collectRows(
    conn,
    `DESCRIBE SELECT * FROM "${name}"`,
    100,
  );
  const columns = describe.rows.map((row) => ({
    name: String(row[0]),
    type: String(row[1]),
  }));
  const count = await collectRows(
    conn,
    `SELECT count(*)::DOUBLE FROM "${name}"`,
    1,
  );
  const sample = await collectRows(
    conn,
    `SELECT * FROM "${name}" LIMIT ${SAMPLE_ROWS}`,
    SAMPLE_ROWS,
  );
  return {
    name,
    label,
    columns,
    rowCount: Number(count.rows[0]?.[0] ?? 0),
    sampleRows: sample.rows,
  };
}

export type DatasetSource =
  | { kind: "url"; url: string }
  | { kind: "file"; file: File };

/**
 * Fetch/read the source, register it as a DuckDB view, and return its
 * schema info. Throws with a person-readable message on failure.
 */
export async function registerDataset(
  source: DatasetSource,
): Promise<DatasetInfo> {
  let label: string;
  let bytes: Uint8Array;
  let sourceUrl: string | undefined;

  if (source.kind === "url") {
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch {
      throw new Error("That does not look like a valid link.");
    }
    sourceUrl = parsed.toString();
    label = parsed.pathname.split("/").pop() || parsed.hostname;
    let res: Response;
    try {
      res = await fetch(parsed.toString());
    } catch {
      throw new Error(
        "The link could not be fetched from your browser. The site may not allow cross-origin downloads; try downloading the file and attaching it instead.",
      );
    }
    if (!res.ok) {
      throw new Error(`The link responded with status ${res.status}.`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    label = source.file.name;
    bytes = new Uint8Array(await source.file.arrayBuffer());
  }

  if (bytes.byteLength === 0) throw new Error("The file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("Files over 100 MB are too large for the browser.");
  }

  const { db, conn } = await getInstance();
  const format = detectFormat(label);
  const name = tableNameFor(label, new Set(registered.keys()));
  const fileName = `${name}.${format}`;

  if (format === "xlsx") {
    try {
      await conn.query("INSTALL excel; LOAD excel;");
    } catch {
      throw new Error(
        "Excel files are not supported in the browser yet. Save the sheet as CSV and attach that.",
      );
    }
  }

  await db.registerFileBuffer(fileName, bytes);
  try {
    await conn.query(
      `CREATE OR REPLACE VIEW "${name}" AS SELECT * FROM ${readerFor(format, fileName)}`,
    );
    const info = { ...(await introspect(conn, name, label)), sourceUrl };
    registered.set(name, info);
    return info;
  } catch (e) {
    await db.dropFile(fileName).catch(() => {});
    throw new Error(
      `The file could not be read as ${format}: ${e instanceof Error ? e.message.split("\n")[0] : "unknown error"}`,
    );
  }
}

export async function dropDataset(name: string) {
  const info = registered.get(name);
  if (!info) return;
  registered.delete(name);
  const { db, conn } = await getInstance();
  await conn.query(`DROP VIEW IF EXISTS "${name}"`).catch(() => {});
  await db.dropFile(`${name}.${detectFormat(info.label)}`).catch(() => {});
}

/**
 * Run the model's SQL and return a capped envelope. Never throws: errors
 * become error envelopes so the model can correct itself.
 */
export async function runQuery(sql: string): Promise<QueryResultEnvelope> {
  if (registered.size === 0) {
    return {
      status: "error",
      error:
        "No datasets are loaded in this browser session. Ask the person to re-attach their file or link.",
    };
  }
  try {
    const { conn } = await getInstance();
    const { columns, rows, rowCount } = await collectRows(
      conn,
      sql,
      RESULT_MAX_ROWS,
    );
    return capResult(columns, rows, rowCount);
  } catch (e) {
    return {
      status: "error",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 1_000),
    };
  }
}
