/**
 * Project field bounds, shared by the web forms, the MCP contracts, and the D1
 * writes so the three surfaces cannot drift. The forms truncate to these
 * lengths; MCP rejects anything longer instead of silently shortening it.
 */
export const PROJECT_LIMITS = {
  titleChars: 120,
  oneLinerChars: 300,
  notesChars: 4_000,
  buildingBlocks: 20,
} as const;
