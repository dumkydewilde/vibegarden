// Optional secrets merged into the generated Env (worker-configuration.d.ts).
// Set via `wrangler secret put` in production or .dev.vars locally.
interface Env {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
