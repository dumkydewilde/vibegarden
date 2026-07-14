export type Model = {
  id: string;
  label: string;
  note: string;
};

/**
 * The Gardener's model menu (OpenRouter ids, verified 2026-07-14).
 * First entry is the default for new users.
 */
export const models: Model[] = [
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", note: "default" },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    note: "fast + cheap",
  },
  { id: "qwen/qwen3.7-plus", label: "Qwen3.7 Plus", note: "huge context" },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B",
    note: "free",
  },
];

export const defaultModel = models[0];

export function findModel(id: string | null | undefined): Model | undefined {
  return models.find((m) => m.id === id);
}
