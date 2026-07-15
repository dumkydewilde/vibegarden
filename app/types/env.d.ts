// Optional secrets merged into the generated Env (worker-configuration.d.ts).
// Set via `wrangler secret put` in production or .dev.vars locally.
interface Env {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Enables the Gardener's fresh_reads tool. Use a read-scaling token. */
  MOTHERDUCK_TOKEN?: string;
  /** Defaults to pg.us-east-1-aws.motherduck.com. */
  MOTHERDUCK_PG_HOST?: string;
  /** Existing database to open the connection on; defaults to my_db. */
  MOTHERDUCK_DATABASE?: string;
}
