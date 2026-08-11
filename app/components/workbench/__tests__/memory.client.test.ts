import { describe, expect, it } from "vitest";

import {
  agentMemory,
  MEMORY_MAX_ENTRIES,
  MEMORY_VALUE_MAX_CHARS,
} from "../memory.client";

function memoryFor(testName: string) {
  return agentMemory(`agent-${testName}`, `user-${testName}`);
}

describe("agentMemory", () => {
  it("stores and retrieves a value in its agent and user namespace", async () => {
    const memory = memoryFor("round-trip");

    await memory.set("topic", "garden design");

    await expect(memory.get("topic")).resolves.toBe("garden design");
    await expect(memory.get("missing")).resolves.toBeNull();
    await expect(
      agentMemory("agent-round-trip", "another-user").get("topic"),
    ).resolves.toBeNull();
  });

  it("lists at most 20 entries with the newest value first", async () => {
    const memory = memoryFor("list-order");
    for (let index = 0; index < 25; index++) {
      await memory.set(`key-${index}`, `value-${index}`);
    }

    await expect(memory.list()).resolves.toEqual(
      Array.from({ length: 20 }, (_, index) => {
        const storedIndex = 24 - index;
        return {
          key: `key-${storedIndex}`,
          value: `value-${storedIndex}`,
        };
      }),
    );
  });

  it("rejects values above the storage cap with a clear error", async () => {
    const memory = memoryFor("value-cap");

    await expect(
      memory.set("too-large", "x".repeat(MEMORY_VALUE_MAX_CHARS + 1)),
    ).rejects.toThrow(
      `Memory values must be ${MEMORY_VALUE_MAX_CHARS} characters or fewer.`,
    );
    await expect(memory.get("too-large")).resolves.toBeNull();
  });

  it("evicts the oldest entry after the namespace reaches its cap", async () => {
    const memory = memoryFor("eviction");
    for (let index = 0; index <= MEMORY_MAX_ENTRIES; index++) {
      await memory.set(`key-${index}`, `value-${index}`);
    }

    await expect(memory.get("key-0")).resolves.toBeNull();
    await expect(memory.get("key-1")).resolves.toBe("value-1");
    await expect(memory.get(`key-${MEMORY_MAX_ENTRIES}`)).resolves.toBe(
      `value-${MEMORY_MAX_ENTRIES}`,
    );
  });
});
