import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "~/lib/mcp/cursor.server";

describe("MCP cursors", () => {
  const secret = "cursor-test-secret";

  it("round-trips an opaque cursor only for its collection", async () => {
    const encoded = await encodeCursor(secret, {
      kind: "projects",
      position: { updatedAt: 42, id: "project-2" },
    });
    expect(encoded).not.toContain("project-2");
    await expect(decodeCursor(secret, "projects", encoded)).resolves.toEqual({
      kind: "projects",
      position: { updatedAt: 42, id: "project-2" },
    });
    await expect(decodeCursor(secret, "messages", encoded)).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });

  it("round-trips a conversation message position", async () => {
    const encoded = await encodeCursor(secret, {
      kind: "conversation_messages",
      position: { createdAt: 42, id: "message-2" },
    });

    await expect(decodeCursor(secret, "conversation_messages", encoded)).resolves.toEqual({
      kind: "conversation_messages",
      position: { createdAt: 42, id: "message-2" },
    });
  });

  it("rejects tampering and malformed payloads", async () => {
    const encoded = await encodeCursor(secret, {
      kind: "content",
      position: { offset: 20 },
    });
    await expect(decodeCursor(secret, "content", `${encoded}x`)).rejects.toMatchObject({
      code: "invalid_cursor",
    });
    await expect(decodeCursor(secret, "content", "not-a-cursor")).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });
});
