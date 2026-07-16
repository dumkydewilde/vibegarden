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

export function findModel(id: string | null | undefined): Model | undefined {
  return models.find((m) => m.id === id);
}
