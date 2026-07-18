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
};

const FREE_GUARDRAIL = "vibegarden:free-only:v1";
const sanitizedFailure = "Club AI provisioning could not be completed.";

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
    ...(club.modelPolicy === "all_models" && club.spendingLimitUsd !== null
      ? { limitUsd: club.spendingLimitUsd }
      : {}),
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
      candidate_ciphertext AS candidateCiphertext, candidate_iv AS candidateIv
      FROM club_ai_credentials WHERE club_id = ?`,
  ).bind(clubId).first<CredentialRow>();
  if (!result) throw new Error("Club AI credential record not found.");
  return result;
}

function clientFor(env: Env, client?: ClubAiManagementClient) {
  return client ?? new OpenRouterManagementClient(env);
}

/** Acquire a short reconciliation lease so concurrent requests cannot mint two keys. */
async function claimProvisioning(env: Env, clubId: string): Promise<boolean> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE club_ai_credentials
       SET provisioning_state = 'pending', last_attempt_at = ?, sanitized_error = NULL
       WHERE club_id = ? AND provisioning_state != 'disabled'
         AND (provisioning_state != 'pending' OR last_attempt_at IS NULL OR last_attempt_at < ?)`,
  ).bind(now, clubId, now - 30_000).run();
  return result.meta.changes === 1;
}

async function markFailed(env: Env, clubId: string) {
  await env.DB.prepare(
    "UPDATE club_ai_credentials SET provisioning_state = 'failed', sanitized_error = ? WHERE club_id = ? AND provisioning_state != 'disabled'",
  ).bind(sanitizedFailure, clubId).run();
}

async function ensureGuardrail(
  env: Env,
  clubRow: ClubRow,
  keyHash: string,
  client: ClubAiManagementClient,
  previousGuardrailId?: string | null,
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
  if (previousGuardrailId && previousGuardrailId !== guardrail.id) {
    const previous = guardrails.find((item) => item.id === previousGuardrailId);
    if (previous) {
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
  await env.DB.prepare(
    "UPDATE club_ai_credentials SET remote_guardrail_id = ? WHERE club_id = ?",
  ).bind(guardrail.id, clubRow.id).run();
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
): Promise<CreatedOpenRouterKey> {
  const created = await client.createKey({ name: keyName(clubId), limit: 0 });
  try {
    const encrypted = await encryptCredential(created.key, env.OPENROUTER_CREDENTIAL_KEY_V1!, 1, clubId);
    await env.DB.prepare(
      `UPDATE club_ai_credentials SET key_hash = ?, key_suffix = ?, ciphertext = ?, iv = ?, key_version = ?,
       candidate_key_hash = NULL, candidate_key_suffix = NULL, candidate_ciphertext = NULL, candidate_iv = NULL
       WHERE club_id = ?`,
    ).bind(created.hash, created.key.slice(-4), encrypted.ciphertext, encrypted.iv, encrypted.keyVersion, clubId).run();
    return created;
  } catch (error) {
    await client.updateKey(created.hash, { disabled: true }).catch(() => undefined);
    throw error;
  }
}

/** Reconciles the remote key and guardrail, remaining unavailable until both agree. */
export async function provisionClubAi(env: Env, clubId: string, suppliedClient?: ClubAiManagementClient) {
  const client = clientFor(env, suppliedClient);
  const clubRow = await club(env, clubId);
  if (!(await claimProvisioning(env, clubId))) return;
  const current = await credential(env, clubId);
  try {
    const keys = await client.listKeys(true);
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
      hash = (await createAndStoreCurrent(env, clubId, client)).hash;
    }
    await ensureGuardrail(env, clubRow, hash!, client, current.remoteGuardrailId);
    await env.DB.prepare(
      "UPDATE club_ai_credentials SET provisioning_state = 'ready', synced_policy = ?, last_synced_at = ?, sanitized_error = NULL WHERE club_id = ?",
    ).bind(clubRow.modelPolicy, Date.now(), clubId).run();
  } catch (error) {
    await markFailed(env, clubId);
    throw new Error(sanitizedFailure);
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
  if (!(await claimProvisioning(env, clubId))) return;
  const old = await credential(env, clubId);
  try {
    const keys = await client.listKeys(true);
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
        await env.DB.prepare(
          "UPDATE club_ai_credentials SET candidate_key_hash = ?, candidate_key_suffix = ?, candidate_ciphertext = ?, candidate_iv = ? WHERE club_id = ?",
        ).bind(created.hash, created.key.slice(-4), encrypted.ciphertext, encrypted.iv, clubId).run();
        candidateHash = created.hash;
      } catch (error) {
        await client.updateKey(created.hash, { disabled: true }).catch(() => undefined);
        throw error;
      }
    }
    await ensureGuardrail(env, clubRow, candidateHash!, client, old.remoteGuardrailId);
    const alreadyPromoted = candidateHash === old.keyHash;
    if (!alreadyPromoted) {
      // Retain the candidate fields until all predecessor keys are disabled.
      // A retry can then recognize the promoted candidate and finish safely.
      await env.DB.prepare(
        `UPDATE club_ai_credentials SET key_hash = candidate_key_hash, key_suffix = candidate_key_suffix,
         ciphertext = candidate_ciphertext, iv = candidate_iv, provisioning_state = 'pending'
         WHERE club_id = ?`,
      ).bind(clubId).run();
    }
    await disableRemote(
      client,
      keys,
      keys.filter((key) => key.name === keyName(clubId) && key.hash !== candidateHash).map((key) => key.hash),
    );
    await env.DB.prepare(
      `UPDATE club_ai_credentials SET candidate_key_hash = NULL, candidate_key_suffix = NULL,
       candidate_ciphertext = NULL, candidate_iv = NULL, provisioning_state = 'ready',
       synced_policy = ?, last_synced_at = ?, sanitized_error = NULL WHERE club_id = ?`,
    ).bind(clubRow.modelPolicy, Date.now(), clubId).run();
  } catch (error) {
    await markFailed(env, clubId);
    throw new Error(sanitizedFailure);
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
  if (disabled && current.keyHash) {
    const client = clientFor(env, suppliedClient);
    const keys = await client.listKeys(true);
    await disableRemote(client, keys, [current.keyHash, current.candidateKeyHash]);
  }
  await env.DB.prepare(
    "UPDATE club_ai_credentials SET provisioning_state = ?, synced_policy = CASE WHEN ? THEN NULL ELSE synced_policy END WHERE club_id = ?",
  ).bind(disabled ? "disabled" : "pending", disabled ? 1 : 0, clubId).run();
}
