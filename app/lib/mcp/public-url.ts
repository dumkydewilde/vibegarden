const FALLBACK_ORIGIN = "https://vibegarden.club";

/** Public MCP endpoint people paste into Claude, ChatGPT, or Gemini. */
export function mcpServerUrl(appOrigin?: string) {
  try {
    return new URL("/mcp", appOrigin || FALLBACK_ORIGIN).toString();
  } catch {
    return `${FALLBACK_ORIGIN}/mcp`;
  }
}
