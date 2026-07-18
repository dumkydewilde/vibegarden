import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  clubCredentialNeedsProvisioning,
  getClubChatCredential,
  provisionClubAi,
  rotateClubCredential,
  setClubCredentialDisabled,
  syncClubPolicy,
  type ClubAiManagementClient,
} from "~/lib/club-ai.server";
import type {
  CreatedOpenRouterKey,
  OpenRouterGuardrail,
  OpenRouterGuardrailInput,
  OpenRouterKey,
  OpenRouterKeyInput,
  OpenRouterKeyPatch,
} from "~/lib/openrouter-management.server";

const credentialKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const testEnv = {
  DB: env.DB,
  OPENROUTER_CREDENTIAL_KEY_V1: credentialKey,
  OPENROUTER_WORKSPACE_ID: "workspace-test",
} as Env;

class FakeManagementClient implements ClubAiManagementClient {
  keys: OpenRouterKey[] = [];
  guardrails: OpenRouterGuardrail[] = [];
  assignments = new Map<string, Set<string>>();
  created = 0;
  failAssignments = false;
  failDisableHash: string | null = null;
  failListKeys = false;
  blockNextList: Promise<void> | null = null;
  onListBlocked: (() => void) | null = null;

  async listKeys() {
    if (this.failListKeys) throw new Error("provider stalled");
    if (this.blockNextList) {
      const gate = this.blockNextList;
      this.blockNextList = null;
      this.onListBlocked?.();
      await gate;
    }
    return this.keys;
  }
  async createKey(input: OpenRouterKeyInput): Promise<CreatedOpenRouterKey> {
    const key: OpenRouterKey = { hash: `hash-${++this.created}`, name: input.name, disabled: false, limit: input.limit, limitReset: input.limitReset, workspaceId: input.workspaceId };
    this.keys.push(key);
    return { ...key, key: `sk-${key.hash}` };
  }
  async updateKey(hash: string, patch: OpenRouterKeyPatch) {
    if (patch.disabled && hash === this.failDisableHash) {
      throw new Error("disable failed");
    }
    const key = this.keys.find((item) => item.hash === hash)!;
    Object.assign(key, patch);
    return key;
  }
  async listGuardrails() { return this.guardrails; }
  async createGuardrail(input: OpenRouterGuardrailInput) {
    const guardrail: OpenRouterGuardrail = { id: `guardrail-${this.guardrails.length + 1}`, name: input.name, allowedModels: input.allowedModels ?? null, limitUsd: input.limitUsd, resetInterval: input.resetInterval, workspaceId: input.workspaceId };
    this.guardrails.push(guardrail);
    return guardrail;
  }
  async updateGuardrail(id: string, patch: Partial<OpenRouterGuardrailInput>) {
    const guardrail = this.guardrails.find((item) => item.id === id)!;
    Object.assign(guardrail, patch);
    return guardrail;
  }
  async assignKeyToGuardrail(id: string, hash: string) {
    if (this.failAssignments) throw new Error("provider details must not escape");
    const assigned = this.assignments.get(id) ?? new Set<string>();
    assigned.add(hash);
    this.assignments.set(id, assigned);
    return 1;
  }
  async listKeyAssignments(id: string) { return [...(this.assignments.get(id) ?? [])]; }
}

async function club(id: string, policy: "free_only" | "all_models" = "free_only") {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
    .bind(id, id, id, policy, now, now).run();
  await env.DB.prepare("INSERT INTO club_ai_credentials (club_id, provisioning_state) VALUES (?, 'pending')")
    .bind(id).run();
}

describe("club AI credential lifecycle", () => {
  it("provisions an encrypted credential only after confirmed guardrail assignment", async () => {
    await club("club-ai-first");
    const client = new FakeManagementClient();

    await provisionClubAi(testEnv, "club-ai-first", client);

    expect(client.keys).toEqual([expect.objectContaining({ name: "vibegarden:club:club-ai-first", limit: 0, limitReset: undefined })]);
    expect(client.guardrails[0]).toMatchObject({ name: "vibegarden:free-only:v1" });
    expect(client.assignments.get(client.guardrails[0].id)).toEqual(new Set(["hash-1"]));
    expect(await getClubChatCredential(testEnv, "club-ai-first")).toBe("sk-hash-1");
    const stored = await env.DB.prepare("SELECT ciphertext, iv, provisioning_state, synced_policy FROM club_ai_credentials WHERE club_id = ?").bind("club-ai-first").first<Record<string, string>>();
    expect(stored).toMatchObject({ provisioning_state: "ready", synced_policy: "free_only" });
    expect(`${stored?.ciphertext}${stored?.iv}`).not.toContain("sk-hash-1");
  });

  it("fails closed on policy drift, resumes idempotently, and safely rotates", async () => {
    await club("club-ai-drift", "all_models");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-drift", client);
    expect(client.created).toBe(1);

    await env.DB.prepare("UPDATE clubs SET model_policy = 'free_only' WHERE id = ?").bind("club-ai-drift").run();
    await syncClubPolicy(testEnv, "club-ai-drift", client);
    expect(await getClubChatCredential(testEnv, "club-ai-drift")).toBe("sk-hash-1");
    expect(client.created).toBe(1);
    expect(client.guardrails[0].allowedModels).toEqual([
      "google/gemma-4-26b-a4b-it:free",
    ]);

    await rotateClubCredential(testEnv, "club-ai-drift", client);
    expect(client.created).toBe(2);
    expect(client.keys.find((key) => key.hash === "hash-1")?.disabled).toBe(true);
    expect(await getClubChatCredential(testEnv, "club-ai-drift")).toBe("sk-hash-2");
  });

  it("resumes a promoted candidate if disabling its predecessor fails", async () => {
    await club("club-ai-rotate-retry");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-rotate-retry", client);
    client.failDisableHash = "hash-1";

    await expect(rotateClubCredential(testEnv, "club-ai-rotate-retry", client)).rejects.toThrow(
      "Club AI provisioning could not be completed.",
    );
    client.failDisableHash = null;
    await syncClubPolicy(testEnv, "club-ai-rotate-retry", client);

    expect(client.created).toBe(2);
    expect(client.keys.find((key) => key.hash === "hash-1")?.disabled).toBe(true);
    expect(await getClubChatCredential(testEnv, "club-ai-rotate-retry")).toBe("sk-hash-2");
  });

  it("reuses the free guardrail while giving WOTF and every club its own key", async () => {
    await club("club-ai-free-a");
    await club("club_wotf", "all_models");
    const client = new FakeManagementClient();

    await provisionClubAi(testEnv, "club-ai-free-a", client);
    await provisionClubAi(testEnv, "club_wotf", client);
    // A retry has a usable local cipher and must not mint another key.
    await provisionClubAi(testEnv, "club-ai-free-a", client);

    expect(client.created).toBe(2);
    expect(client.guardrails.map((guardrail) => guardrail.name)).toEqual([
      "vibegarden:free-only:v1",
      "vibegarden:club:club_wotf",
    ]);
    expect(await getClubChatCredential(testEnv, "club-ai-free-a")).toBe("sk-hash-1");
    expect(await getClubChatCredential(testEnv, "club_wotf")).toBe("sk-hash-2");
  });

  it("never widens the shared free guardrail when another club upgrades", async () => {
    await club("club-ai-free-stays-free");
    await club("club-ai-upgrade");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-free-stays-free", client);
    await provisionClubAi(testEnv, "club-ai-upgrade", client);

    await env.DB.prepare("UPDATE clubs SET model_policy = 'all_models' WHERE id = ?")
      .bind("club-ai-upgrade").run();
    await syncClubPolicy(testEnv, "club-ai-upgrade", client);

    expect(client.guardrails.find((guardrail) => guardrail.name === "vibegarden:free-only:v1")?.allowedModels)
      .toEqual(["google/gemma-4-26b-a4b-it:free"]);
  });

  it("leases reconciliation so concurrent provisioning cannot mint duplicate keys", async () => {
    await club("club-ai-concurrent");
    const client = new FakeManagementClient();

    await Promise.all([
      provisionClubAi(testEnv, "club-ai-concurrent", client),
      provisionClubAi(testEnv, "club-ai-concurrent", client),
    ]);

    expect(client.created).toBe(1);
    expect(await getClubChatCredential(testEnv, "club-ai-concurrent")).toBe("sk-hash-1");
  });

  it("reclaims an expired lease without letting its slow prior owner overwrite the result", async () => {
    await club("club-ai-lease-reclaim");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-lease-reclaim", client);
    let release!: () => void;
    let blocked!: () => void;
    client.blockNextList = new Promise((resolve) => { release = resolve; });
    client.onListBlocked = () => blocked();
    const first = provisionClubAi(testEnv, "club-ai-lease-reclaim", client);
    await new Promise<void>((resolve) => { blocked = resolve; });

    await env.DB.prepare(
      "UPDATE club_ai_credentials SET provisioning_lease_heartbeat_at = ? WHERE club_id = ?",
    ).bind(Date.now() - 31_000, "club-ai-lease-reclaim").run();
    await provisionClubAi(testEnv, "club-ai-lease-reclaim", client);
    release();

    await expect(first).rejects.toThrow("Club AI provisioning could not be completed.");
    expect(await getClubChatCredential(testEnv, "club-ai-lease-reclaim")).toBe("sk-hash-1");
  });

  it("records only a sanitized error when provider reconciliation fails", async () => {
    await club("club-ai-failure");
    const client = new FakeManagementClient();
    client.failAssignments = true;

    await expect(provisionClubAi(testEnv, "club-ai-failure", client)).rejects.toThrow(
      "Club AI provisioning could not be completed.",
    );
    expect(await env.DB.prepare("SELECT provisioning_state AS state, sanitized_error AS error FROM club_ai_credentials WHERE club_id = ?").bind("club-ai-failure").first()).toEqual({
      state: "failed",
      error: "Club AI provisioning could not be completed.",
    });
    expect(await clubCredentialNeedsProvisioning(testEnv, "club-ai-failure")).toBe(true);
  });

  it("replaces an unusable lost one-time credential and disables it on archival", async () => {
    await club("club-ai-lost");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-lost", client);
    await env.DB.prepare("UPDATE club_ai_credentials SET ciphertext = NULL, iv = NULL WHERE club_id = ?").bind("club-ai-lost").run();

    await provisionClubAi(testEnv, "club-ai-lost", client);
    expect(client.keys).toHaveLength(2);
    expect(client.keys[0].disabled).toBe(true);
    await setClubCredentialDisabled(testEnv, "club-ai-lost", true, client);
    await expect(getClubChatCredential(testEnv, "club-ai-lost")).rejects.toThrow(/not ready/i);
    expect(await clubCredentialNeedsProvisioning(testEnv, "club-ai-lost")).toBe(false);
    expect(client.keys[1].disabled).toBe(true);
  });

  it("sets local disabled state before a remote disable attempt can fail", async () => {
    await club("club-ai-disable-first");
    const client = new FakeManagementClient();
    await provisionClubAi(testEnv, "club-ai-disable-first", client);
    client.failListKeys = true;

    await expect(setClubCredentialDisabled(testEnv, "club-ai-disable-first", true, client)).rejects.toThrow("provider stalled");
    await expect(getClubChatCredential(testEnv, "club-ai-disable-first")).rejects.toThrow(/not ready/i);
  });
});
