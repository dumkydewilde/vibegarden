/** Shared result envelope helpers for browser-executed workbench tools. */

export const CALL_RESULT_MAX_CHARS = 4_000;
export const CALL_ERROR_MAX_CHARS = 1_000;

export type CallRequest = {
  tool: string;
  args: Record<string, unknown>;
};

export type CallResultEnvelope =
  | {
      status: "ok";
      resultText: string;
      totalChars: number;
      truncated: boolean;
    }
  | { status: "error"; error: string };

/** Cap a successful result before it crosses the browser boundary. */
export function capCallResult(
  raw: string,
): Extract<CallResultEnvelope, { status: "ok" }> {
  return {
    status: "ok",
    resultText: raw.slice(0, CALL_RESULT_MAX_CHARS),
    totalChars: raw.length,
    truncated: raw.length > CALL_RESULT_MAX_CHARS,
  };
}

/** Cap a tool error before returning it to the model. */
export function callErrorEnvelope(
  message: string,
): Extract<CallResultEnvelope, { status: "error" }> {
  return {
    status: "error",
    error: message.slice(0, CALL_ERROR_MAX_CHARS),
  };
}

/** Parse an untrusted client envelope and enforce the caps again. */
export function parseCallResultEnvelope(
  raw: string,
): CallResultEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CallResultEnvelope>;
    if (parsed.status === "error") {
      return typeof parsed.error === "string"
        ? callErrorEnvelope(parsed.error)
        : null;
    }
    if (
      parsed.status === "ok" &&
      typeof parsed.resultText === "string" &&
      typeof parsed.totalChars === "number" &&
      Number.isSafeInteger(parsed.totalChars) &&
      parsed.totalChars >= parsed.resultText.length
    ) {
      const resultText = parsed.resultText.slice(0, CALL_RESULT_MAX_CHARS);
      return {
        status: "ok",
        resultText,
        totalChars: parsed.totalChars,
        truncated: parsed.totalChars > resultText.length,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** One line summarizing a workbench call result for model-bound history. */
export function callSummaryLine(
  tool: string,
  envelope: CallResultEnvelope,
): string {
  if (envelope.status === "error") {
    return `[${tool} result: error: ${envelope.error.slice(0, 200)}]`;
  }
  const truncated = envelope.truncated ? ", truncated" : "";
  return `[${tool} result: ok, ${envelope.totalChars} chars${truncated}]`;
}
