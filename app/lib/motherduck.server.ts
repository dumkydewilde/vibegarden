import pg from "pg";

/**
 * Read-only access to Dumky's RSS feed summaries, a MotherDuck share. The
 * worker talks to MotherDuck's Postgres-compatible endpoint (DuckDB SQL
 * over the PG wire protocol) with a configured MotherDuck token; use a
 * read-scaling token, which is read-only by design. The share itself is
 * read-only for consumers either way.
 */

const SHARE_URL =
  "md:_share/dumky_share_public/f1e480aa-1edc-494f-b9bb-e190339fd518";
const TABLE = "dumky_share.raw.rss_feed_summaries";

/** Kinds worth surfacing to participants, per the share's content_type. */
export const FRESH_READ_TYPES = ["news", "opinion", "tutorial"] as const;

export type FreshReadsQuery = {
  /** Free-text filter against title, summary, and key insight. */
  topic?: string;
  /** One of FRESH_READ_TYPES; anything else means all of them. */
  contentType?: string;
  limit?: number;
};

export type MotherDuckConfig = {
  token?: string;
  host?: string;
  database?: string;
};

export type FreshRead = {
  title: string;
  url: string;
  feed: string;
  contentType: string;
  score: string;
  postDate: string;
  keyInsight: string;
  summary: string;
};

/** DuckDB string literal: quote-doubling is all standard strings need. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function buildFreshReadsSql(query: FreshReadsQuery): string {
  const conditions = ["TRY_CAST(interestingness_score AS INT) >= 3"];

  const type = FRESH_READ_TYPES.find((t) => t === query.contentType);
  if (type) {
    // content_type sometimes holds pipe-combined values like "opinion|tutorial".
    conditions.push(`content_type LIKE ${literal(`%${type}%`)}`);
  } else {
    conditions.push(
      `regexp_matches(content_type, ${literal(FRESH_READ_TYPES.join("|"))})`,
    );
  }

  const topic = query.topic?.trim().slice(0, 80);
  if (topic) {
    const pattern = literal(`%${topic}%`);
    conditions.push(
      `(title ILIKE ${pattern} OR summary ILIKE ${pattern} OR key_insight ILIKE ${pattern})`,
    );
  }

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 8), 1), 20);

  return [
    "SELECT title, url, feed_title, content_type, interestingness_score, post_date, key_insight, summary",
    `FROM ${TABLE}`,
    `WHERE ${conditions.join("\n  AND ")}`,
    "ORDER BY TRY_CAST(post_date AS TIMESTAMP) DESC NULLS LAST",
    `LIMIT ${limit}`,
  ].join("\n");
}

export async function queryFreshReads(
  config: MotherDuckConfig,
  query: FreshReadsQuery,
): Promise<FreshRead[]> {
  if (!config.token) {
    throw new Error("MotherDuck token is not configured.");
  }
  const client = new pg.Client({
    host: config.host ?? "pg.us-east-1-aws.motherduck.com",
    port: 5432,
    user: "postgres",
    password: config.token,
    database: config.database ?? "my_db",
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  await client.connect();
  try {
    try {
      await client.query(`ATTACH IF NOT EXISTS '${SHARE_URL}' AS dumky_share`);
    } catch {
      // Shares are region-scoped, so an eu-central-1 account cannot attach
      // this us-east-1 share. There the account holds a synced copy under
      // the same qualified name (scripts/sync-fresh-reads.sh); the query
      // below finds it, or fails with the real error.
    }
    const { rows } = await client.query(buildFreshReadsSql(query));
    return rows.map((row: Record<string, string | null>) => ({
      title: row.title ?? "",
      url: row.url ?? "",
      feed: row.feed_title ?? "",
      contentType: row.content_type ?? "",
      score: row.interestingness_score ?? "",
      postDate: (row.post_date ?? "").slice(0, 10),
      keyInsight: row.key_insight ?? "",
      summary: row.summary ?? "",
    }));
  } finally {
    await client.end().catch(() => {});
  }
}

/** Compact plain-text rendering for the model's tool result. */
export function formatFreshReads(reads: FreshRead[]): string {
  if (reads.length === 0) {
    return "No matching reads found. Try without a topic filter, or a broader one.";
  }
  return reads
    .map((r) =>
      [
        `- [${r.title}](${r.url})`,
        `  ${r.contentType}, score ${r.score}, ${r.postDate}, from ${r.feed}`,
        r.keyInsight ? `  Key insight: ${r.keyInsight}` : null,
        r.summary ? `  Summary: ${r.summary}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}
