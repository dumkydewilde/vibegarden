import type { ModelPolicy } from "~/db/schema";

export type Model = {
  id: string;
  label: string;
  note: string;
  /** Whether the model supports tool calling on OpenRouter. */
  tools: boolean;
};

/**
 * The Gardener's model menu (OpenRouter ids, verified 2026-07-14).
 * First entry is the default for new users.
 */
export const models: Model[] = [
  {
    id: "minimax/minimax-m3",
    label: "MiniMax M3",
    note: "default",
    tools: true,
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    note: "thorough, slower",
    tools: true,
  },
  {
    id: "z-ai/glm-5.2",
    label: "GLM 5.2",
    note: "strong + capable",
    tools: true,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    note: "fast + cheap",
    tools: true,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    note: "strong all-rounder",
    tools: true,
  },
  {
    id: "qwen/qwen3.7-plus",
    label: "Qwen3.7 Plus",
    note: "huge context",
    tools: true,
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B",
    note: "free",
    tools: false,
  },
];

export const defaultModel = models[0];

/** The curated models a free-only club may use. */
export const freeModels = models.filter((model) => model.id.endsWith(":free"));

if (freeModels.length === 0) {
  throw new Error("Model policy requires at least one free model.");
}

export const defaultFreeModel = freeModels[0];

/** The shared model allowlist for discovery, provisioned guardrails, and chat. */
export function modelsForPolicy(policy: ModelPolicy): Model[] {
  return policy === "free_only" ? freeModels : models;
}

/** Resolves untrusted and stale preferences to a model allowed by the club. */
export function resolveClubModel(
  policy: ModelPolicy,
  requested?: string,
  saved?: string | null,
): Model {
  const allowed = modelsForPolicy(policy);
  return (
    allowed.find((model) => model.id === requested) ??
    allowed.find((model) => model.id === saved) ??
    allowed[0]
  );
}

export function findModel(id: string | null | undefined): Model | undefined {
  return models.find((m) => m.id === id);
}
