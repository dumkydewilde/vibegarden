export type ProvisioningState = "pending" | "ready" | "failed" | "disabled";

/** The only fields permitted in operational logs. Do not add untrusted metadata. */
export type OperationalLog = {
  level: "info" | "warn" | "error";
  operation: string;
  requestId?: string;
  clubId?: string;
  provisioningState?: ProvisioningState;
  code?: string;
};

/**
 * Writes a small, structured event without ever serializing caller-supplied
 * objects. Keeping the copy explicit means accidental keys, tokens, content,
 * answers, and ciphertext cannot reach Worker logs.
 */
export function logOperation(input: OperationalLog) {
  const event = {
    level: input.level,
    operation: input.operation,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.clubId === undefined ? {} : { clubId: input.clubId }),
    ...(input.provisioningState === undefined ? {} : { provisioningState: input.provisioningState }),
    ...(input.code === undefined ? {} : { code: input.code }),
  };
  console[input.level](JSON.stringify(event));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/**
 * Audit records are retained, so they get the same explicit treatment as
 * logs. Unknown actions intentionally retain no metadata.
 */
export function sanitizeAuditMetadata(action: string, metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  switch (action) {
    case "member.role_changed": {
      const role = metadata.role;
      return role === "admin" || role === "member" ? { role } : undefined;
    }
    case "ownership.transferred": {
      const previousOwnerId = stringValue(metadata.previousOwnerId);
      return previousOwnerId === undefined ? undefined : { previousOwnerId };
    }
    case "club.slug_changed": {
      const previousSlug = stringValue(metadata.previousSlug);
      const slug = stringValue(metadata.slug);
      return previousSlug === undefined || slug === undefined ? undefined : { previousSlug, slug };
    }
    case "club.model_policy_changed": {
      const modelPolicy = metadata.modelPolicy;
      return modelPolicy === "free_only" || modelPolicy === "all_models" ? { modelPolicy } : undefined;
    }
    case "club.spending_limit_changed": {
      const spendingLimitUsd = metadata.spendingLimitUsd;
      return spendingLimitUsd === null || (typeof spendingLimitUsd === "number" && Number.isSafeInteger(spendingLimitUsd) && spendingLimitUsd >= 0)
        ? { spendingLimitUsd }
        : undefined;
    }
    default:
      return undefined;
  }
}

export function serializeAuditMetadata(action: string, metadata?: Record<string, unknown>) {
  const sanitized = sanitizeAuditMetadata(action, metadata);
  return sanitized === undefined ? null : JSON.stringify(sanitized);
}
