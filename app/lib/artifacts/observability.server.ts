type ArtifactEvent = {
  operation: string;
  requestId?: string;
  userHash?: string;
  artifactId?: string;
  versionId?: string;
  uploadId?: string;
  count?: number;
  bytes?: number;
  durationMs?: number;
  outcome?: string;
  errorCode?: string;
};

const EVENT_FIELDS = [
  "operation",
  "requestId",
  "userHash",
  "artifactId",
  "versionId",
  "uploadId",
  "count",
  "bytes",
  "durationMs",
  "outcome",
  "errorCode",
] as const;

function allowlistedEvent(event: ArtifactEvent): ArtifactEvent {
  return Object.fromEntries(
    EVENT_FIELDS.flatMap((field) => event[field] === undefined ? [] : [[field, event[field]]]),
  ) as ArtifactEvent;
}

/** Emits a stable, deliberately narrow artifact operation log payload. */
export function recordArtifactEvent(event: ArtifactEvent): void {
  console.info("artifact_event", allowlistedEvent(event));
}

/** Writes numeric operational measures without paths, keys, content, or identities. */
export function writeArtifactMetric(env: Pick<Env, "ARTIFACT_METRICS">, event: ArtifactEvent): void {
  const safe = allowlistedEvent(event);
  env.ARTIFACT_METRICS.writeDataPoint({
    indexes: [safe.operation, safe.outcome ?? "unknown", safe.errorCode ?? null],
    doubles: [safe.count ?? 0, safe.bytes ?? 0, safe.durationMs ?? 0],
  });
}
