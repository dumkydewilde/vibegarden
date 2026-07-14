export type ProjectStatus = "seed" | "growing" | "bloomed";

export const statusLabel: Record<ProjectStatus, string> = {
  seed: "Seed",
  growing: "Growing",
  bloomed: "Bloomed",
};
