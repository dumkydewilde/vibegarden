/**
 * A data query in the chat: the SQL the Gardener wrote, the result table
 * the browser produced, and an optional mini chart. Four states: running
 * (still streaming), ok, error, and stale (a reloaded conversation whose
 * data no longer lives in this browser session).
 */

import { Database } from "lucide-react";
import { MiniChart } from "./mini-chart";
import type {
  Cell,
  ChartSpec,
  QueryResultEnvelope,
} from "@vibegarden/agent-web";

function SqlDetails({ sql }: { sql: string }) {
  return (
    <details className="group border-t">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
        <span className="group-open:hidden">Show SQL</span>
        <span className="hidden group-open:inline">Hide SQL</span>
      </summary>
      <pre className="max-h-40 overflow-auto border-t bg-muted/40 p-3 text-xs">
        <code>{sql}</code>
      </pre>
    </details>
  );
}

function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Cell[][];
}) {
  // min-w-max + nowrap: wide results scroll horizontally instead of
  // squeezing the columns; the header row scrolls along and sticks on top.
  return (
    <div className="max-h-60 overflow-auto">
      <table className="min-w-full border-collapse whitespace-nowrap text-xs">
        <thead>
          <tr className="sticky top-0 bg-card">
            {columns.map((c) => (
              <th
                key={c}
                className="border-b px-2 py-1.5 text-left font-medium text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    typeof cell === "number"
                      ? "px-2 py-1 text-right tabular-nums"
                      : "px-2 py-1"
                  }
                >
                  {cell === null ? (
                    <span className="text-muted-foreground">null</span>
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataToolResult({
  sql,
  chart,
  result,
  running,
}: {
  sql: string;
  chart?: ChartSpec;
  /** Missing result + running = executing now; + !running = stale. */
  result?: QueryResultEnvelope;
  running: boolean;
}) {
  const header = (
    <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
      <Database className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        {chart?.title ?? "Looking at your data"}
      </span>
      {result?.status === "ok" && (
        <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
          {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
        </span>
      )}
    </div>
  );

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-card shadow-sm">
      {header}
      {!result && running && (
        <p className="border-t px-3 py-2.5 text-xs text-muted-foreground">
          <span className="shimmer">Running the query on your data...</span>
        </p>
      )}
      {!result && !running && (
        <p className="border-t px-3 py-2.5 text-xs text-muted-foreground">
          This query ran in an earlier session. Re-attach the data and ask
          again to re-run it.
        </p>
      )}
      {result?.status === "error" && (
        <p className="border-t px-3 py-2.5 text-xs text-destructive">
          The query failed: {result.error}
        </p>
      )}
      {result?.status === "ok" && (
        <div className="border-t">
          {chart && (
            <div className="px-2 pt-3">
              <MiniChart
                spec={chart}
                columns={result.columns}
                rows={result.rows}
              />
            </div>
          )}
          <ResultTable columns={result.columns} rows={result.rows} />
          {result.truncated && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              Showing the first {result.rows.length} of {result.rowCount}{" "}
              rows.
            </p>
          )}
        </div>
      )}
      <SqlDetails sql={sql} />
    </div>
  );
}
