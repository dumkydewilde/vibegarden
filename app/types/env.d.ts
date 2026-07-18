// Optional secrets merged into the generated Env (worker-configuration.d.ts).
// Set via `wrangler secret put` in production or .dev.vars locally.
interface Env {
  /** Development-only credential for /dev/login. */
  DEV_LOGIN_TOKEN?: string;
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
  /** OpenRouter management API credential. Server-only. */
  OPENROUTER_MANAGEMENT_KEY?: string;
  /** Base64-encoded 32-byte AES-GCM key for encrypted club credentials. */
  OPENROUTER_CREDENTIAL_KEY_V1?: string;
  /** Optional OpenRouter workspace where club credentials are provisioned. */
  OPENROUTER_WORKSPACE_ID?: string;
  /** Temporary WOTF-only fallback to the legacy shared OpenRouter key. */
  ALLOW_WOTF_LEGACY_KEY?: string;
}
