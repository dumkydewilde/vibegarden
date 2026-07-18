import type { D1Migration } from "cloudflare:test";

declare global {
  interface TaskOneTestBindings {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
    MCP_GENERAL_LIMITER: RateLimit;
    MCP_HISTORY_LIMITER: RateLimit;
    TEST_MIGRATIONS: D1Migration[];
  }

  interface Env extends TaskOneTestBindings {}

  namespace Cloudflare {
    interface Env extends TaskOneTestBindings {}
  }
}
