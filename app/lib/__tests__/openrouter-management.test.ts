import { describe, expect, it, vi } from "vitest";
import {
  OpenRouterManagementClient,
  type OpenRouterKeyPatch,
} from "~/lib/openrouter-management.server";

const managementEnv = {
  OPENROUTER_MANAGEMENT_KEY: "management-test-key",
  OPENROUTER_WORKSPACE_ID: "workspace-1",
} as Env;

function clientWith(response: Response, fetchImpl = vi.fn(async () => response)) {
  return {
    client: new OpenRouterManagementClient(managementEnv, fetchImpl),
    fetchImpl,
  };
}

describe("OpenRouterManagementClient", () => {
  it("creates a key with documented fields and only sends the management key to OpenRouter", async () => {
    const { client, fetchImpl } = clientWith(
      Response.json({
        data: { hash: "hash-1", name: "club-a", disabled: false },
        key: "sk-or-v1-one-time",
      }),
    );

    const created = await client.createKey({ name: "club-a", limit: 0 });

    expect(created).toEqual({
      hash: "hash-1",
      name: "club-a",
      disabled: false,
      key: "sk-or-v1-one-time",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/keys",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer management-test-key",
        }),
        body: JSON.stringify({ name: "club-a", limit: 0, workspace_id: "workspace-1" }),
      }),
    );
  });

  it("uses the documented key, guardrail, and assignment endpoints", async () => {
    const responses = [
      Response.json({ data: [{ hash: "key-1", name: "club-a", disabled: false }] }),
      Response.json({ data: { hash: "key-1", name: "club-a", disabled: true } }),
      Response.json({ data: [{ id: "guardrail-1", name: "free", allowed_models: ["model:free"] }] }),
      Response.json({ data: { id: "guardrail-1", name: "free", allowed_models: ["model:free"] } }),
      Response.json({ data: { id: "guardrail-1", name: "free", allowed_models: ["model:free"] } }),
      Response.json({ assigned_count: 1 }),
      Response.json({ data: [{ key_hash: "key-1" }] }),
      new Response(null, { status: 204 }),
    ];
    const fetchImpl = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next;
    });
    const client = new OpenRouterManagementClient(managementEnv, fetchImpl);

    await expect(client.listKeys(true)).resolves.toEqual([
      { hash: "key-1", name: "club-a", disabled: false },
    ]);
    await client.updateKey("key-1", { disabled: true });
    await client.listGuardrails();
    await client.createGuardrail({ name: "free", allowedModels: ["model:free"] });
    await client.updateGuardrail("guardrail-1", { allowedModels: ["model:free"] });
    await expect(client.assignKeyToGuardrail("guardrail-1", "key-1")).resolves.toBe(1);
    await expect(client.listKeyAssignments("guardrail-1")).resolves.toEqual(["key-1"]);
    await expect(client.deleteKey("key-1")).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://openrouter.ai/api/v1/keys?include_disabled=true&workspace_id=workspace-1", "GET"],
      ["https://openrouter.ai/api/v1/keys/key-1", "PATCH"],
      ["https://openrouter.ai/api/v1/guardrails?workspace_id=workspace-1", "GET"],
      ["https://openrouter.ai/api/v1/guardrails", "POST"],
      ["https://openrouter.ai/api/v1/guardrails/guardrail-1", "PATCH"],
      ["https://openrouter.ai/api/v1/guardrails/guardrail-1/assignments/keys", "POST"],
      ["https://openrouter.ai/api/v1/guardrails/guardrail-1/assignments/keys", "GET"],
      ["https://openrouter.ai/api/v1/keys/key-1", "DELETE"],
    ]);
  });

  it("allows a managed key name to be repaired", async () => {
    const { client, fetchImpl } = clientWith(
      Response.json({ data: { hash: "key-1", name: "vibegarden:club:club-a", disabled: false } }),
    );
    const patch: OpenRouterKeyPatch = { name: "vibegarden:club:club-a" };

    await client.updateKey("key-1", patch);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/keys/key-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "vibegarden:club:club-a" }),
      }),
    );
  });

  it("returns sanitized failures without provider response bodies", async () => {
    const { client } = clientWith(
      new Response('{"error":"sk-or-v1-sensitive-body"}', { status: 503 }),
    );

    await expect(client.listKeys()).rejects.toThrow("OpenRouter request failed (503)");
    await expect(client.listKeys()).rejects.not.toThrow(/sensitive-body/);
  });
});
