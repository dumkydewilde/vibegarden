const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

type ManagementEnv = {
  OPENROUTER_MANAGEMENT_KEY?: string;
  OPENROUTER_WORKSPACE_ID?: string;
};

export type OpenRouterKey = {
  hash: string;
  name: string;
  disabled: boolean;
  limit?: number | null;
  limitReset?: "daily" | "weekly" | "monthly" | null;
  workspaceId?: string;
};

/** A one-time provider credential. Keep it server-side and encrypt immediately. */
export type CreatedOpenRouterKey = OpenRouterKey & { key: string };

export type OpenRouterKeyInput = {
  name: string;
  limit?: number | null;
  limitReset?: "daily" | "weekly" | "monthly" | null;
  workspaceId?: string;
};

/** OpenRouter permits PATCHing a key's name as well as its limits and state. */
export type OpenRouterKeyPatch = Partial<OpenRouterKeyInput> & {
  disabled?: boolean;
};

export type OpenRouterGuardrail = {
  id: string;
  name: string;
  allowedModels: string[] | null;
  limitUsd?: number | null;
  resetInterval?: "daily" | "weekly" | "monthly" | null;
  workspaceId?: string;
};

export type OpenRouterGuardrailInput = {
  name: string;
  allowedModels?: string[] | null;
  limitUsd?: number | null;
  resetInterval?: "daily" | "weekly" | "monthly" | null;
  workspaceId?: string;
};

export type OpenRouterGuardrailPatch = Omit<
  Partial<OpenRouterGuardrailInput>,
  "name"
>;

type Fetch = typeof globalThis.fetch;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  return typeof value === "number" || value === null ? value : undefined;
}

function optionalInterval(
  value: unknown,
): "daily" | "weekly" | "monthly" | null | undefined {
  return value === "daily" || value === "weekly" || value === "monthly" || value === null
    ? value
    : undefined;
}

function parseKey(value: unknown): OpenRouterKey {
  const data = object(value);
  const hash = data && string(data.hash);
  const name = data && string(data.name);
  if (!data || !hash || !name || typeof data.disabled !== "boolean") {
    throw new Error("OpenRouter returned an invalid response.");
  }
  const parsed: OpenRouterKey = { hash, name, disabled: data.disabled };
  const limit = optionalNumber(data.limit);
  const limitReset = optionalInterval(data.limit_reset);
  const workspaceId = string(data.workspace_id);
  if (limit !== undefined) parsed.limit = limit;
  if (limitReset !== undefined) parsed.limitReset = limitReset;
  if (workspaceId !== undefined) parsed.workspaceId = workspaceId;
  return parsed;
}

function parseGuardrail(value: unknown): OpenRouterGuardrail {
  const data = object(value);
  const id = data && string(data.id);
  const name = data && string(data.name);
  const allowedModels = data?.allowed_models;
  if (
    !data ||
    !id ||
    !name ||
    (allowedModels !== null &&
      (!Array.isArray(allowedModels) || !allowedModels.every((model) => typeof model === "string")))
  ) {
    throw new Error("OpenRouter returned an invalid response.");
  }
  const parsed: OpenRouterGuardrail = {
    id,
    name,
    allowedModels: allowedModels as string[] | null,
  };
  const limitUsd = optionalNumber(data.limit_usd);
  const resetInterval = optionalInterval(data.reset_interval);
  const workspaceId = string(data.workspace_id);
  if (limitUsd !== undefined) parsed.limitUsd = limitUsd;
  if (resetInterval !== undefined) parsed.resetInterval = resetInterval;
  if (workspaceId !== undefined) parsed.workspaceId = workspaceId;
  return parsed;
}

function responseData(value: unknown): unknown {
  const body = object(value);
  if (!body || !("data" in body)) {
    throw new Error("OpenRouter returned an invalid response.");
  }
  return body.data;
}

function keyBody(input: OpenRouterKeyInput | OpenRouterKeyPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ("name" in input && input.name !== undefined) body.name = input.name;
  if (input.limit !== undefined) body.limit = input.limit;
  if (input.limitReset !== undefined) body.limit_reset = input.limitReset;
  if (input.workspaceId !== undefined) body.workspace_id = input.workspaceId;
  if ("disabled" in input && input.disabled !== undefined) body.disabled = input.disabled;
  return body;
}

function guardrailBody(
  input: OpenRouterGuardrailInput | OpenRouterGuardrailPatch,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ("name" in input && input.name !== undefined) body.name = input.name;
  if (input.allowedModels !== undefined) body.allowed_models = input.allowedModels;
  if (input.limitUsd !== undefined) body.limit_usd = input.limitUsd;
  if (input.resetInterval !== undefined) body.reset_interval = input.resetInterval;
  if (input.workspaceId !== undefined) body.workspace_id = input.workspaceId;
  return body;
}

/** Typed, server-only OpenRouter Management API boundary. */
export class OpenRouterManagementClient {
  private readonly managementKey: string;
  private readonly workspaceId?: string;
  private readonly fetchImpl: Fetch;

  constructor(env: ManagementEnv, fetchImpl: Fetch = fetch) {
    if (!env.OPENROUTER_MANAGEMENT_KEY) {
      throw new Error("OPENROUTER_MANAGEMENT_KEY is not set.");
    }
    this.managementKey = env.OPENROUTER_MANAGEMENT_KEY;
    this.workspaceId = env.OPENROUTER_WORKSPACE_ID;
    this.fetchImpl = fetchImpl;
  }

  private url(path: string, query?: Record<string, string>): string {
    const url = new URL(`${OPENROUTER_API_BASE}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.managementKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new Error("OpenRouter returned an invalid response.");
    }
  }

  async listKeys(includeDisabled = false): Promise<OpenRouterKey[]> {
    const query: Record<string, string> = {};
    if (includeDisabled) query.include_disabled = "true";
    if (this.workspaceId) query.workspace_id = this.workspaceId;
    const path = this.url("/keys", query).replace(OPENROUTER_API_BASE, "");
    const data = responseData(await this.request(path, { method: "GET" }));
    if (!Array.isArray(data)) throw new Error("OpenRouter returned an invalid response.");
    return data.map(parseKey);
  }

  async createKey(input: OpenRouterKeyInput): Promise<CreatedOpenRouterKey> {
    const body = keyBody({ ...input, workspaceId: input.workspaceId ?? this.workspaceId });
    const response = object(await this.request("/keys", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    const key = response && string(response.key);
    if (!response || !key) throw new Error("OpenRouter returned an invalid response.");
    return { ...parseKey(responseData(response)), key };
  }

  async updateKey(hash: string, patch: OpenRouterKeyPatch): Promise<OpenRouterKey> {
    const data = responseData(await this.request(`/keys/${encodeURIComponent(hash)}`, {
      method: "PATCH",
      body: JSON.stringify(keyBody(patch)),
    }));
    return parseKey(data);
  }

  async listGuardrails(): Promise<OpenRouterGuardrail[]> {
    const query = this.workspaceId ? `?workspace_id=${encodeURIComponent(this.workspaceId)}` : "";
    const data = responseData(await this.request(`/guardrails${query}`, { method: "GET" }));
    if (!Array.isArray(data)) throw new Error("OpenRouter returned an invalid response.");
    return data.map(parseGuardrail);
  }

  async createGuardrail(input: OpenRouterGuardrailInput): Promise<OpenRouterGuardrail> {
    const body = guardrailBody({ ...input, workspaceId: input.workspaceId ?? this.workspaceId });
    const data = responseData(await this.request("/guardrails", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    return parseGuardrail(data);
  }

  async updateGuardrail(
    id: string,
    patch: OpenRouterGuardrailPatch,
  ): Promise<OpenRouterGuardrail> {
    const data = responseData(await this.request(`/guardrails/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(guardrailBody(patch)),
    }));
    return parseGuardrail(data);
  }

  async assignKeyToGuardrail(id: string, keyHash: string): Promise<number> {
    const response = object(await this.request(
      `/guardrails/${encodeURIComponent(id)}/assignments/keys`,
      { method: "POST", body: JSON.stringify({ key_hashes: [keyHash] }) },
    ));
    if (!response || typeof response.assigned_count !== "number") {
      throw new Error("OpenRouter returned an invalid response.");
    }
    return response.assigned_count;
  }

  async listKeyAssignments(id: string): Promise<string[]> {
    const data = responseData(await this.request(
      `/guardrails/${encodeURIComponent(id)}/assignments/keys`,
      { method: "GET" },
    ));
    if (!Array.isArray(data)) throw new Error("OpenRouter returned an invalid response.");
    const hashes = data.map((assignment) => string(object(assignment)?.key_hash));
    if (hashes.some((hash) => !hash)) {
      throw new Error("OpenRouter returned an invalid response.");
    }
    return hashes as string[];
  }

  async deleteKey(hash: string): Promise<void> {
    await this.request(`/keys/${encodeURIComponent(hash)}`, { method: "DELETE" });
  }
}
