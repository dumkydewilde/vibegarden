export const PROJECT_STATUSES = ["seed", "growing", "bloomed"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const statusLabel: Record<ProjectStatus, string> = {
  seed: "Seed",
  growing: "Growing",
  bloomed: "Bloomed",
};
