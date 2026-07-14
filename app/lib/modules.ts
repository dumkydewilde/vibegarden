/**
 * The building blocks participants can combine into projects.
 * Used by the Idea Garden, project forms, and the Gardener's prompt.
 */
export const modules = [
  "CSV file",
  "Google Sheet",
  "Photos or scans",
  "Dashboard",
  "Game",
  "Summarizer",
  "Content finder",
] as const;

export type ModuleName = (typeof modules)[number];

export function isModuleName(value: string): value is ModuleName {
  return (modules as readonly string[]).includes(value);
}
