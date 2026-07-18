import { describe, expect, it, vi } from "vitest";
import { logOperation, sanitizeAuditMetadata } from "~/lib/operational-log.server";

describe("logOperation", () => {
  it("serializes only its allowlisted operational fields", () => {
    const write = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logOperation({
      level: "info",
      operation: "club_ai.reconciled",
      requestId: "request-safe",
      clubId: "club-safe",
      provisioningState: "ready",
      code: "repaired",
      key: "sk-live-secret",
      token: "token-secret",
      content: "private-content",
      answers: ["private-answer"],
      ciphertext: "ciphertext-secret",
    } as never);

    const serialized = String(write.mock.calls[0]?.[0]);
    expect(serialized).toContain("club-safe");
    expect(serialized).toContain("request-safe");
    expect(serialized).toContain("club_ai.reconciled");
    expect(serialized).toContain("ready");
    expect(serialized).not.toMatch(/sk-live-secret|token-secret|private-content|private-answer|ciphertext-secret/);
    write.mockRestore();
  });
});

describe("sanitizeAuditMetadata", () => {
  it("keeps only action-specific safe audit fields", () => {
    expect(sanitizeAuditMetadata("club.model_policy_changed", {
      modelPolicy: "all_models",
      key: "sk-live-secret",
      token: "token-secret",
      content: "private-content",
    })).toEqual({ modelPolicy: "all_models" });
    expect(sanitizeAuditMetadata("unknown.action", { clubId: "club-safe" })).toBeUndefined();
  });
});
