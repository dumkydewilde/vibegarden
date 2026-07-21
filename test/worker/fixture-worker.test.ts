import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker fixture", () => {
  it("responds through the Worker runtime", async () => {
    const response = await SELF.fetch("https://worker.test/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
