import { createContext } from "react-router";

/** Cloudflare bindings, set per request in workers/app.ts. */
export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();
