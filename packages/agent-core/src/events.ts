/**
 * The events one agent turn produces, surface-agnostic. The web chat
 * serializes them into the `[[tool:...]]` marker stream (see
 * the web adapter); other surfaces (a bot, an MCP server) consume
 * them directly and decide what to render, buffer, or drop.
 */
export type AgentEvent =
  /** A streamed piece of the assistant's prose. */
  | { type: "text"; delta: string }
  /** Tool activity worth showing while it runs, e.g. "reading article X". */
  | { type: "note"; kind: string; value: string }
  /** A diagram the model produced; the surface chooses how to render it. */
  | { type: "diagram"; title: string; diagram: string }
  /**
   * A tool call the surface must fulfill itself (e.g. run SQL in the
   * browser). The turn ends here; the surface resumes the conversation
   * with the result in a follow-up request.
   */
  | { type: "delegated-call"; tool: string; payload: unknown }
  /**
   * Something went wrong. "upstream": the model API failed between tool
   * rounds. "exception": the turn itself threw. The turn ends here.
   */
  | { type: "error"; stage: "upstream" | "exception"; status?: number; detail?: string }
  /** The turn finished normally (also after a delegated-call). */
  | { type: "done"; finishReason: string | null };
