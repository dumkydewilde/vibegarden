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

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

/** Parse an untrusted client envelope and enforce the caps again. */
export function parseCallResultEnvelope(
  raw: string,
): CallResultEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const envelope = parsed as Record<string, unknown>;
    if (envelope.status === "error") {
      return hasExactKeys(envelope, ["status", "error"]) &&
        typeof envelope.error === "string"
        ? callErrorEnvelope(envelope.error)
        : null;
    }
    if (
      envelope.status === "ok" &&
      hasExactKeys(envelope, [
        "status",
        "resultText",
        "totalChars",
        "truncated",
      ]) &&
      typeof envelope.resultText === "string" &&
      typeof envelope.totalChars === "number" &&
      Number.isSafeInteger(envelope.totalChars) &&
      envelope.totalChars >= envelope.resultText.length &&
      typeof envelope.truncated === "boolean"
    ) {
      const resultText = envelope.resultText.slice(0, CALL_RESULT_MAX_CHARS);
      return {
        status: "ok",
        resultText,
        totalChars: envelope.totalChars,
        truncated: envelope.totalChars > resultText.length,
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
    const error = envelope.error.replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, " ");
    return `[${tool} result: error: ${error.slice(0, 200)}]`;
  }
  const truncated = envelope.truncated ? ", truncated" : "";
  return `[${tool} result: ok, ${envelope.totalChars} chars${truncated}]`;
}
