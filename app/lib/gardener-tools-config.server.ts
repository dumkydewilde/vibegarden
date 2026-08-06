import type { GardenerToolsConfig } from "./gardener-tools.server";

/** Translate Worker bindings once, at the Vibe Garden host boundary. */
export function gardenerToolsConfig(
  env: Env,
  options: { agentContext?: { agentId: string } } = {},
): GardenerToolsConfig {
  return {
    agentContext: options.agentContext,
    freshReads: env.MOTHERDUCK_TOKEN
      ? {
          token: env.MOTHERDUCK_TOKEN,
          host: env.MOTHERDUCK_PG_HOST,
          database: env.MOTHERDUCK_DATABASE,
        }
      : undefined,
  };
}
