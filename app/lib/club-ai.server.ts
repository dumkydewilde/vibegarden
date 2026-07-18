import { decryptCredential, encryptCredential } from "~/lib/credential-crypto.server";
import { modelsForPolicy } from "~/lib/models";
import {
  OpenRouterManagementClient,
  type CreatedOpenRouterKey,
  type OpenRouterGuardrail,
  type OpenRouterGuardrailInput,
  type OpenRouterKey,
  type OpenRouterKeyInput,
  type OpenRouterKeyPatch,
} from "~/lib/openrouter-management.server";
import type { ModelPolicy } from "~/db/schema";

export type ClubAiManagementClient = {
  listKeys(includeDisabled?: boolean): Promise<OpenRouterKey[]>;
  createKey(input: OpenRouterKeyInput): Promise<CreatedOpenRouterKey>;
  updateKey(hash: string, patch: OpenRouterKeyPatch): Promise<OpenRouterKey>;
  listGuardrails(): Promise<OpenRouterGuardrail[]>;
  createGuardrail(input: OpenRouterGuardrailInput): Promise<OpenRouterGuardrail>;
  updateGuardrail(id: string, patch: Partial<OpenRouterGuardrailInput>): Promise<OpenRouterGuardrail>;
  assignKeyToGuardrail(id: string, keyHash: string): Promise<number>;
  listKeyAssignments(id: string): Promise<string[]>;
};

type ClubRow = {
  id: string;
  modelPolicy: ModelPolicy;
  spendingLimitUsd: number | null;
};

type CredentialRow = {
  clubId: string;
  keyHash: string | null;
  keySuffix: string | null;
  ciphertext: string | null;
  iv: string | null;
  keyVersion: number;
  provisioningState: "pending" | "ready" | "failed" | "disabled";
  syncedPolicy: ModelPolicy | null;
  remoteGuardrailId: string | null;
  candidateKeyHash: string | null;
  candidateKeySuffix: string | null;
  candidateCiphertext: string | null;
  candidateIv: string | null;
  provisioningLeaseToken: string | null;
  provisioningLeaseHeartbeatAt: number | null;
};

const FREE_GUARDRAIL = "vibegarden:free-only:v1";
const sanitizedFailure = "Club AI provisioning could not be completed.";
const LEASE_TIMEOUT_MS = 30_000;
const LEASE_HEARTBEAT_MS = 5_000;

function keyName(clubId: string) {
  return `vibegarden:club:${clubId}`;
}

function guardrailName(club: ClubRow) {
  return club.modelPolicy === "free_only" ? FREE_GUARDRAIL : keyName(club.id);
}

function guardrailInput(club: ClubRow): OpenRouterGuardrailInput {
  return {
    name: guardrailName(club),
    allowedModels: modelsForPolicy(club.modelPolicy).map((model) => model.id),
    limitUsd: club.modelPolicy === "all_models" ? club.spendingLimitUsd : null,
    resetInterval: null,
  };
}

async function club(env: Env, clubId: string): Promise<ClubRow> {
  const result = await env.DB.prepare(
    "SELECT id, model_policy AS modelPolicy, spending_limit_usd AS spendingLimitUsd FROM clubs WHERE id = ?",
  ).bind(clubId).first<ClubRow>();
  if (!result) throw new Error("Club not found.");
  return result;
}

async function credential(env: Env, clubId: string): Promise<CredentialRow> {
  const result = await env.DB.prepare(
    `SELECT club_id AS clubId, key_hash AS keyHash, key_suffix AS keySuffix, ciphertext, iv,
      key_version AS keyVersion, provisioning_state AS provisioningState,
      synced_policy AS syncedPolicy, remote_guardrail_id AS remoteGuardrailId,
      candidate_key_hash AS candidateKeyHash, candidate_key_suffix AS candidateKeySuffix,
      candidate_ciphertext AS candidateCiphertext, candidate_iv AS candidateIv,
      provisioning_lease_token AS provisioningLeaseToken,
      provisioning_lease_heartbeat_at AS provisioningLeaseHeartbeatAt
      FROM club_ai_credentials WHERE club_id = ?`,
  ).bind(clubId).first<CredentialRow>();
  if (!result) throw new Error("Club AI credential record not found.");
  return result;
}

function clientFor(env: Env, client?: ClubAiManagementClient) {
  return client ?? new OpenRouterManagementClient(env);
}

/** Acquire a short reconciliation lease so concurrent requests cannot mint two keys. */
async function claimProvisioning(env: Env, clubId: string): Promise<string | null> {
  const now = Date.now();
  const token = crypto.randomUUID();
  const result = await env.DB.prepare(
    `UPDATE club_ai_credentials
       SET provisioning_state = 'pending', last_attempt_at = ?, sanitized_error = NULL,
           provisioning_lease_token = ?, provisioning_lease_heartbeat_at = ?
       WHERE club_id = ? AND provisioning_state != 'disabled'
         AND (provisioning_state != 'pending' OR provisioning_lease_heartbeat_at IS NULL OR provisioning_lease_heartbeat_at < ?)`,
  ).bind(now, token, now, clubId, now - LEASE_TIMEOUT_MS).run();
  return result.meta.changes === 1 ? token : null;
}

async function touchLease(env: Env, clubId: string, token: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE club_ai_credentials SET provisioning_lease_heartbeat_at = ? WHERE club_id = ? AND provisioning_lease_token = ? AND provisioning_state = 'pending'",
  ).bind(Date.now(), clubId, token).run();
  return result.meta.changes === 1;
}

function heartbeatLease(env: Env, clubId: string, token: string) {
  const timer = setInterval(() => { void touchLease(env, clubId, token); }, LEASE_HEARTBEAT_MS);
  return () => clearInterval(timer);
}

async function requireLease(env: Env, clubId: string, token: string) {
  if (!(await touchLease(env, clubId, token))) throw new Error("Provisioning lease was lost.");
}

async function markFailed(env: Env, clubId: string, token: string) {
  await env.DB.prepare(
    "UPDATE club_ai_credentials SET provisioning_state = 'failed', sanitized_error = ?, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ? AND provisioning_lease_token = ? AND provisioning_state != 'disabled'",
  ).bind(sanitizedFailure, clubId, token).run();
}

async function ensureGuardrail(
  env: Env,
  clubRow: ClubRow,
  keyHash: string,
  client: ClubAiManagementClient,
  previousGuardrailId?: string | null,
  leaseToken?: string,
): Promise<OpenRouterGuardrail> {
  const desired = guardrailInput(clubRow);
  const guardrails = await client.listGuardrails();
  const current = guardrails.find((item) => item.name === desired.name);
  const guardrail = current
    ? await client.updateGuardrail(current.id, desired)
    : await client.createGuardrail(desired);
  // OpenRouter permits a key to retain multiple guardrail assignments. On a
  // downgrade, make any formerly assigned per-club guardrail no broader than
  // the new policy before declaring the credential ready.
  if (clubRow.modelPolicy === "free_only" && previousGuardrailId && previousGuardrailId !== guardrail.id) {
    const previous = guardrails.find((item) => item.id === previousGuardrailId);
    // Never widen the shared free guardrail during a club upgrade. Only a
    // per-club all-model guardrail is tightened on a downgrade.
    if (previous?.name === keyName(clubRow.id)) {
      await client.updateGuardrail(previous.id, {
        allowedModels: desired.allowedModels,
        limitUsd: desired.limitUsd ?? null,
        resetInterval: desired.resetInterval ?? null,
      });
    }
  }
  await client.assignKeyToGuardrail(guardrail.id, keyHash);
  const assignments = await client.listKeyAssignments(guardrail.id);
  if (!assignments.includes(keyHash)) throw new Error("Guardrail assignment was not confirmed.");
  const stored = await env.DB.prepare(
    "UPDATE club_ai_credentials SET remote_guardrail_id = ? WHERE club_id = ? AND (? IS NULL OR provisioning_lease_token = ?)",
  ).bind(guardrail.id, clubRow.id, leaseToken ?? null, leaseToken ?? null).run();
  if (leaseToken && stored.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
  return guardrail;
}

async function disableRemote(client: ClubAiManagementClient, keys: OpenRouterKey[], hashes: Iterable<string | null>) {
  const values = new Set([...hashes].filter((hash): hash is string => !!hash));
  await Promise.all(
    keys.filter((key) => values.has(key.hash) && !key.disabled)
      .map((key) => client.updateKey(key.hash, { disabled: true })),
  );
}

async function createAndStoreCurrent(
  env: Env,
  clubId: string,
  client: ClubAiManagementClient,
  leaseToken?: string,
): Promise<CreatedOpenRouterKey> {
  const created = await client.createKey({ name: keyName(clubId), limit: 0 });
  try {
    const encrypted = await encryptCredential(created.key, env.OPENROUTER_CREDENTIAL_KEY_V1!, 1, clubId);
    const stored = await env.DB.prepare(
      `UPDATE club_ai_credentials SET key_hash = ?, key_suffix = ?, ciphertext = ?, iv = ?, key_version = ?,
       candidate_key_hash = NULL, candidate_key_suffix = NULL, candidate_ciphertext = NULL, candidate_iv = NULL
       WHERE club_id = ? AND (? IS NULL OR provisioning_lease_token = ?)`,
    ).bind(created.hash, created.key.slice(-4), encrypted.ciphertext, encrypted.iv, encrypted.keyVersion, clubId, leaseToken ?? null, leaseToken ?? null).run();
    if (leaseToken && stored.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
    return created;
  } catch (error) {
    await client.updateKey(created.hash, { disabled: true }).catch(() => undefined);
    throw error;
  }
}

async function completePromotedCandidate(
  env: Env,
  clubRow: ClubRow,
  current: CredentialRow,
  keys: OpenRouterKey[],
  client: ClubAiManagementClient,
  leaseToken: string,
): Promise<boolean> {
  if (!current.candidateKeyHash || current.candidateKeyHash !== current.keyHash) return false;
  await ensureGuardrail(env, clubRow, current.keyHash!, client, current.remoteGuardrailId, leaseToken);
  await requireLease(env, clubRow.id, leaseToken);
  await disableRemote(
    client,
    keys,
    keys.filter((key) => key.name === keyName(clubRow.id) && key.hash !== current.keyHash).map((key) => key.hash),
  );
  const completed = await env.DB.prepare(
    `UPDATE club_ai_credentials SET candidate_key_hash = NULL, candidate_key_suffix = NULL,
     candidate_ciphertext = NULL, candidate_iv = NULL, provisioning_state = 'ready',
     synced_policy = ?, last_synced_at = ?, sanitized_error = NULL,
     provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL
     WHERE club_id = ? AND provisioning_lease_token = ?`,
  ).bind(clubRow.modelPolicy, Date.now(), clubRow.id, leaseToken).run();
  if (completed.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
  return true;
}

/** Reconciles the remote key and guardrail, remaining unavailable until both agree. */
export async function provisionClubAi(env: Env, clubId: string, suppliedClient?: ClubAiManagementClient) {
  const client = clientFor(env, suppliedClient);
  const clubRow = await club(env, clubId);
  const leaseToken = await claimProvisioning(env, clubId);
  if (!leaseToken) return;
  const stopHeartbeat = heartbeatLease(env, clubId, leaseToken);
  const current = await credential(env, clubId);
  try {
    const keys = await client.listKeys(true);
    await requireLease(env, clubId, leaseToken);
    if (await completePromotedCandidate(env, clubRow, current, keys, client, leaseToken)) return;
    const remote = keys.find((key) => key.hash === current.keyHash);
    const usable = !!(
      current.keyHash && current.ciphertext && current.iv && remote && !remote.disabled
    );
    let hash = current.keyHash;
    if (!usable) {
      // A key's plaintext is supplied once. A local record without its cipher
      // cannot be recovered, so revoke the corresponding remote key first.
      await disableRemote(client, keys, [
        current.keyHash,
        current.candidateKeyHash,
        ...keys.filter((key) => key.name === keyName(clubId)).map((key) => key.hash),
      ]);
      hash = (await createAndStoreCurrent(env, clubId, client, leaseToken)).hash;
    }
    await ensureGuardrail(env, clubRow, hash!, client, current.remoteGuardrailId, leaseToken);
    const completed = await env.DB.prepare(
      "UPDATE club_ai_credentials SET provisioning_state = 'ready', synced_policy = ?, last_synced_at = ?, sanitized_error = NULL, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ? AND provisioning_lease_token = ?",
    ).bind(clubRow.modelPolicy, Date.now(), clubId, leaseToken).run();
    if (completed.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
  } catch (error) {
    await markFailed(env, clubId, leaseToken);
    throw new Error(sanitizedFailure);
  } finally {
    stopHeartbeat();
  }
}

/** Synchronizes the policy and fails closed while remote guardrails are stale. */
export async function syncClubPolicy(env: Env, clubId: string, suppliedClient?: ClubAiManagementClient) {
  await provisionClubAi(env, clubId, suppliedClient);
}

/** Returns only a ready, policy-synchronized, encrypted credential. */
export async function getClubChatCredential(env: Env, clubId: string): Promise<string> {
  const [clubRow, current] = await Promise.all([club(env, clubId), credential(env, clubId)]);
  if (
    current.provisioningState !== "ready" ||
    current.syncedPolicy !== clubRow.modelPolicy ||
    !current.ciphertext || !current.iv
  ) {
    throw new Error("Club AI credential is not ready.");
  }
  return decryptCredential({
    clubId,
    ciphertext: current.ciphertext,
    iv: current.iv,
    keyVersion: current.keyVersion,
  }, env);
}

/** Legacy WOTF access is allowed only while its dedicated credential awaits provisioning. */
export async function clubCredentialNeedsProvisioning(env: Env, clubId: string) {
  const current = await credential(env, clubId);
  return current.provisioningState === "pending" || current.provisioningState === "failed";
}

/** Creates and verifies a candidate before changing which key chat can use. */
export async function rotateClubCredential(env: Env, clubId: string, suppliedClient?: ClubAiManagementClient) {
  const client = clientFor(env, suppliedClient);
  const clubRow = await club(env, clubId);
  const leaseToken = await claimProvisioning(env, clubId);
  if (!leaseToken) return;
  const stopHeartbeat = heartbeatLease(env, clubId, leaseToken);
  const old = await credential(env, clubId);
  try {
    const keys = await client.listKeys(true);
    await requireLease(env, clubId, leaseToken);
    let candidateHash = old.candidateKeyHash;
    const candidateRemote = keys.find((key) => key.hash === candidateHash);
    const candidateUsable = !!(
      candidateHash && old.candidateCiphertext && old.candidateIv && candidateRemote && !candidateRemote.disabled
    );
    if (!candidateUsable) {
      await disableRemote(client, keys, [old.candidateKeyHash]);
      const created = await client.createKey({ name: keyName(clubId), limit: 0 });
      try {
        const encrypted = await encryptCredential(created.key, env.OPENROUTER_CREDENTIAL_KEY_V1!, 1, clubId);
        const stored = await env.DB.prepare(
          "UPDATE club_ai_credentials SET candidate_key_hash = ?, candidate_key_suffix = ?, candidate_ciphertext = ?, candidate_iv = ? WHERE club_id = ? AND provisioning_lease_token = ?",
        ).bind(created.hash, created.key.slice(-4), encrypted.ciphertext, encrypted.iv, clubId, leaseToken).run();
        if (stored.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
        candidateHash = created.hash;
      } catch (error) {
        await client.updateKey(created.hash, { disabled: true }).catch(() => undefined);
        throw error;
      }
    }
    await ensureGuardrail(env, clubRow, candidateHash!, client, old.remoteGuardrailId, leaseToken);
    const alreadyPromoted = candidateHash === old.keyHash;
    if (!alreadyPromoted) {
      // Retain the candidate fields until all predecessor keys are disabled.
      // A retry can then recognize the promoted candidate and finish safely.
      await env.DB.prepare(
        `UPDATE club_ai_credentials SET key_hash = candidate_key_hash, key_suffix = candidate_key_suffix,
         ciphertext = candidate_ciphertext, iv = candidate_iv, provisioning_state = 'pending'
         WHERE club_id = ? AND provisioning_lease_token = ?`,
      ).bind(clubId, leaseToken).run();
    }
    await disableRemote(
      client,
      keys,
      keys.filter((key) => key.name === keyName(clubId) && key.hash !== candidateHash).map((key) => key.hash),
    );
    const completed = await env.DB.prepare(
      `UPDATE club_ai_credentials SET candidate_key_hash = NULL, candidate_key_suffix = NULL,
       candidate_ciphertext = NULL, candidate_iv = NULL, provisioning_state = 'ready',
       synced_policy = ?, last_synced_at = ?, sanitized_error = NULL,
       provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL
       WHERE club_id = ? AND provisioning_lease_token = ?`,
    ).bind(clubRow.modelPolicy, Date.now(), clubId, leaseToken).run();
    if (completed.meta.changes !== 1) throw new Error("Provisioning lease was lost.");
  } catch (error) {
    await markFailed(env, clubId, leaseToken);
    throw new Error(sanitizedFailure);
  } finally {
    stopHeartbeat();
  }
}

/** Disables a club credential remotely and makes it unavailable locally. */
export async function setClubCredentialDisabled(
  env: Env,
  clubId: string,
  disabled: boolean,
  suppliedClient?: ClubAiManagementClient,
) {
  const current = await credential(env, clubId);
  // Local revocation wins immediately: a stalled provider must not leave an
  // otherwise-ready decrypted key available to chat.
  await env.DB.prepare(
    "UPDATE club_ai_credentials SET provisioning_state = ?, synced_policy = CASE WHEN ? THEN NULL ELSE synced_policy END, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ?",
  ).bind(disabled ? "disabled" : "pending", disabled ? 1 : 0, clubId).run();
  if (disabled && current.keyHash) {
    const client = clientFor(env, suppliedClient);
    const keys = await client.listKeys(true);
    await disableRemote(client, keys, [current.keyHash, current.candidateKeyHash]);
  }
}
