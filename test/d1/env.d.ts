declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    TEST_WOTF_BACKFILL_SQL: string;
    TEST_WOTF_VERIFY_SQL: string;
    TEST_CONTRACT_SQL: string;
    TEST_CONTRACT_VERIFY_SQL: string;
  }
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      TEST_WOTF_BACKFILL_SQL: string;
      TEST_WOTF_VERIFY_SQL: string;
      TEST_CONTRACT_SQL: string;
      TEST_CONTRACT_VERIFY_SQL: string;
    }
  }
}

export {};
