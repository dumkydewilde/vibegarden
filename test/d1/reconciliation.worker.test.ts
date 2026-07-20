import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getClubChatCredential, reconcileClubAi, type ClubAiManagementClient } from "~/lib/club-ai.server";
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

const credentialKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));
const testEnv = {
  DB: env.DB,
  OPENROUTER_CREDENTIAL_KEY_V1: credentialKey,
} as Env;

async function club(id: string, options: { hash?: string; guardrailId?: string; state?: string } = {}) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, 'all_models', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
  await env.DB.prepare(
    "INSERT INTO club_ai_credentials (club_id, key_hash, ciphertext, iv, remote_guardrail_id, provisioning_state, synced_policy) VALUES (?, ?, ?, ?, ?, ?, 'all_models')",
  ).bind(id, options.hash ?? `hash-${id}`, "ciphertext", "iv", options.guardrailId ?? `guardrail-${id}`, options.state ?? "ready").run();
}

async function credentialAvailability(id: string) {
  return env.DB.prepare(
    "SELECT provisioning_state AS state, synced_policy AS syncedPolicy FROM club_ai_credentials WHERE club_id = ?",
  ).bind(id).first<{ state: string; syncedPolicy: string | null }>();
}

function managedKey(id: string, overrides: Partial<OpenRouterKey> = {}): OpenRouterKey {
  return {
    hash: `hash-${id}`,
    name: `vibegarden:club:${id}`,
    disabled: false,
    limit: 5,
    limitReset: "monthly",
    ...overrides,
  };
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

  it("fails closed when the assigned guardrail is missing", async () => {
    await club("reconcile-missing-guardrail");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-missing-guardrail"));

    await reconcileClubAi(testEnv, client);

    expect(await credentialAvailability("reconcile-missing-guardrail")).toEqual({
      state: "failed",
      syncedPolicy: null,
    });
    await expect(getClubChatCredential(testEnv, "reconcile-missing-guardrail")).rejects.toThrow(/not ready/i);
  });

  it("fails closed while a widened model allowlist is being repaired", async () => {
    await club("reconcile-widened-models");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-widened-models"));
    client.guardrails.push(guardrail("reconcile-widened-models", {
      allowedModels: ["google/gemma-4-26b-a4b-it:free", "paid/model"],
    }));
    let release!: () => void;
    let updateStarted!: () => void;
    const updateGate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { updateStarted = resolve; });
    client.updateGuardrail = async (id, patch) => {
      updateStarted();
      await updateGate;
      const current = client.guardrails.find((item) => item.id === id)!;
      Object.assign(current, patch);
      return current;
    };

    const reconciliation = reconcileClubAi(testEnv, client);
    await started;

    expect(await credentialAvailability("reconcile-widened-models")).toEqual({
      state: "pending",
      syncedPolicy: null,
    });
    await expect(getClubChatCredential(testEnv, "reconcile-widened-models")).rejects.toThrow(/not ready/i);
    release();
    await reconciliation;
    expect(await credentialAvailability("reconcile-widened-models")).toEqual({
      state: "ready",
      syncedPolicy: "all_models",
    });
  });

  it("fails closed when a missing assignment cannot be repaired and confirmed", async () => {
    await club("reconcile-assignment-failure");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-assignment-failure"));
    client.guardrails.push(guardrail("reconcile-assignment-failure"));
    client.assignKeyToGuardrail = async () => { throw new Error("provider rejected assignment"); };

    await reconcileClubAi(testEnv, client);

    expect(await credentialAvailability("reconcile-assignment-failure")).toEqual({
      state: "failed",
      syncedPolicy: null,
    });
    await expect(getClubChatCredential(testEnv, "reconcile-assignment-failure")).rejects.toThrow(/not ready/i);
  });

  it("repairs safe key and guardrail name and limit drift", async () => {
    await club("reconcile-drift");
    const client = new FakeManagementClient();
    client.keys.push(managedKey("reconcile-drift", {
      name: "old key name",
      limit: 0,
    }));
    client.guardrails.push(guardrail("reconcile-drift", { name: "old guardrail name", limitUsd: 17 }));

    await reconcileClubAi(env, client);

    expect(client.keys[0]).toMatchObject({
      name: "vibegarden:club:reconcile-drift",
      limit: 5,
      limitReset: "monthly",
    });
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
