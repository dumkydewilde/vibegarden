import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { reconcileClubAi, type ClubAiManagementClient } from "~/lib/club-ai.server";
import type {
  CreatedOpenRouterKey,
  OpenRouterGuardrail,
  OpenRouterGuardrailInput,
  OpenRouterKey,
  OpenRouterKeyInput,
  OpenRouterKeyPatch,
} from "~/lib/openrouter-management.server";

class FakeManagementClient implements ClubAiManagementClient {
  keys: OpenRouterKey[] = [];
  guardrails: OpenRouterGuardrail[] = [];
  assignments = new Map<string, Set<string>>();
  fail = false;

  async listKeys(): Promise<OpenRouterKey[]> {
    if (this.fail) throw new Error("provider token and content must not escape");
    return this.keys;
  }
  async createKey(_input: OpenRouterKeyInput): Promise<CreatedOpenRouterKey> { throw new Error("not used"); }
  async updateKey(hash: string, patch: OpenRouterKeyPatch): Promise<OpenRouterKey> {
    const key = this.keys.find((item) => item.hash === hash)!;
    Object.assign(key, patch);
    return key;
  }
  async listGuardrails(): Promise<OpenRouterGuardrail[]> { return this.guardrails; }
  async createGuardrail(_input: OpenRouterGuardrailInput): Promise<OpenRouterGuardrail> { throw new Error("not used"); }
  async updateGuardrail(id: string, patch: Partial<OpenRouterGuardrailInput>): Promise<OpenRouterGuardrail> {
    const guardrail = this.guardrails.find((item) => item.id === id)!;
    Object.assign(guardrail, patch);
    return guardrail;
  }
  async assignKeyToGuardrail(id: string, hash: string): Promise<number> {
    const assignment = this.assignments.get(id) ?? new Set<string>();
    assignment.add(hash);
    this.assignments.set(id, assignment);
    return 1;
  }
  async listKeyAssignments(id: string): Promise<string[]> { return [...(this.assignments.get(id) ?? [])]; }
}

async function club(id: string, options: { hash?: string; guardrailId?: string; state?: string } = {}) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
  await env.DB.prepare(
    "INSERT INTO club_ai_credentials (club_id, key_hash, remote_guardrail_id, provisioning_state) VALUES (?, ?, ?, ?)",
  ).bind(id, options.hash ?? `hash-${id}`, options.guardrailId ?? `guardrail-${id}`, options.state ?? "ready").run();
}

function managedKey(id: string, overrides: Partial<OpenRouterKey> = {}): OpenRouterKey {
  return { hash: `hash-${id}`, name: `vibegarden:club:${id}`, disabled: false, limit: 0, ...overrides };
}

function guardrail(id: string, overrides: Partial<OpenRouterGuardrail> = {}): OpenRouterGuardrail {
  return { id: `guardrail-${id}`, name: `vibegarden:club:${id}`, allowedModels: [], limitUsd: null, resetInterval: null, ...overrides };
}

async function findings(id: string) {
  return env.DB.prepare(
    "SELECT kind, status, resolved_at AS resolvedAt FROM ai_reconciliation_findings WHERE club_id = ? ORDER BY kind",
  ).bind(id).all<{ kind: string; status: string; resolvedAt: number | null }>();
}

describe("club AI reconciliation", () => {
  it("repairs a missing guardrail assignment", async () => {
    await club("reconcile-assignment");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-assignment"));
    client.guardrails.push(guardrail("reconcile-assignment"));

    await reconcileClubAi(env, client);

    expect(client.assignments.get("guardrail-reconcile-assignment")).toEqual(new Set(["hash-reconcile-assignment"]));
  });

  it("repairs safe key and guardrail name and limit drift", async () => {
    await club("reconcile-drift");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-drift", { name: "old key name", limit: 12 }));
    client.guardrails.push(guardrail("reconcile-drift", { name: "old guardrail name", limitUsd: 17 }));

    await reconcileClubAi(env, client);

    expect(client.keys[0]).toMatchObject({ name: "vibegarden:club:reconcile-drift", limit: 0 });
    expect(client.guardrails[0]).toMatchObject({ name: "vibegarden:club:reconcile-drift", limitUsd: null });
  });

  it("records an open orphan finding without substituting a remote key", async () => {
    await club("reconcile-orphan");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-orphan", { hash: "unexpected-hash" }));
    client.guardrails.push(guardrail("reconcile-orphan"));

    await reconcileClubAi(env, client);

    expect(await findings("reconcile-orphan")).toEqual(expect.objectContaining({ results: [expect.objectContaining({ kind: "orphaned_key", status: "open" })] }));
    expect(client.assignments.get("guardrail-reconcile-orphan")).toBeUndefined();
  });

  it("records an open duplicate finding and does not choose an assignment", async () => {
    await club("reconcile-duplicate");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-duplicate"), managedKey("reconcile-duplicate", { hash: "duplicate-hash" }));
    client.guardrails.push(guardrail("reconcile-duplicate"));

    await reconcileClubAi(env, client);

    expect(await findings("reconcile-duplicate")).toEqual(expect.objectContaining({ results: [expect.objectContaining({ kind: "duplicate_key", status: "open" })] }));
    expect(client.assignments.get("guardrail-reconcile-duplicate")).toBeUndefined();
  });

  it("resolves a finding when the next reconciliation confirms the condition is gone", async () => {
    await club("reconcile-resolved");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-resolved"), managedKey("reconcile-resolved", { hash: "duplicate-hash" }));
    client.guardrails.push(guardrail("reconcile-resolved"));
    await reconcileClubAi(env, client);
    client.keys.splice(1, 1);

    await reconcileClubAi(env, client);

    expect(await findings("reconcile-resolved")).toEqual(expect.objectContaining({ results: [expect.objectContaining({ kind: "duplicate_key", status: "resolved", resolvedAt: expect.any(Number) })] }));
  });

  it("fails safe and records no misleading repairs when the provider cannot be listed", async () => {
    await club("reconcile-provider-failure");
    const client = new FakeManagementClient();
    client.fail = true;

    await expect(reconcileClubAi(env, client)).resolves.toEqual({ ok: false });
    expect(await findings("reconcile-provider-failure")).toEqual(expect.objectContaining({ results: [] }));
  });

  it("fails safe when scheduled reconciliation has no management credential", async () => {
    await expect(reconcileClubAi({ DB: env.DB } as Env)).resolves.toEqual({ ok: false });
  });
});
