/**
 * Client-safe feedback helpers, shared by the resource-route action and the
 * feedback dialog. No server imports so it can be bundled for the browser.
 */

export const FEEDBACK_MAX = 4000;

const STATUSES = ["new", "read", "resolved"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];

/** Trim and cap feedback. Returns null when there is nothing to send. */
export function normalizeFeedbackBody(raw: string): string | null {
  const body = raw.trim().slice(0, FEEDBACK_MAX);
  return body.length > 0 ? body : null;
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return (
    typeof value === "string" && STATUSES.includes(value as FeedbackStatus)
  );
}
