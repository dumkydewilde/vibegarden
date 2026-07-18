export const ARTIFACT_LIMITS = {
  browserFiles: 500,
  browserBytes: 100 * 1024 * 1024,
  ordinaryFileBytes: 25 * 1024 * 1024,
  mcpFiles: 100,
  mcpBytes: 2 * 1024 * 1024,
  pathBytes: 1024,
  segmentBytes: 255,
  titleChars: 120,
  descriptionChars: 1000,
  origins: 20,
  uploadTtlMs: 24 * 60 * 60 * 1000,
  capabilityTtlSeconds: 300,
  recoveryMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export type ArtifactType = "html" | "file" | "link";
export type ArtifactPackageSource = "browser" | "mcp";

export type ArtifactErrorCode =
  | "invalid_input"
  | "invalid_path"
  | "invalid_type"
  | "limit_exceeded"
  | "invalid_checksum"
  | "invalid_manifest"
  | "idempotency_conflict"
  | "state_conflict"
  | "not_found"
  | "invalid_origin"
  | "insufficient_scope"
  | "storage_unavailable"
  | "internal";

const ERROR_DETAILS: Record<
  ArtifactErrorCode,
  { message: string; status: number; retryable: boolean }
> = {
  invalid_input: { message: "Artifact input is invalid.", status: 400, retryable: false },
  invalid_path: { message: "Artifact path is invalid.", status: 400, retryable: false },
  invalid_type: { message: "Artifact content type is invalid.", status: 415, retryable: false },
  limit_exceeded: { message: "Artifact limit exceeded.", status: 413, retryable: false },
  invalid_checksum: { message: "Artifact checksum is invalid.", status: 400, retryable: false },
  invalid_manifest: { message: "Artifact manifest is invalid.", status: 400, retryable: false },
  idempotency_conflict: { message: "Artifact request conflicts with an earlier request.", status: 409, retryable: false },
  state_conflict: { message: "Artifact state changed. Retry the request.", status: 409, retryable: true },
  not_found: { message: "Artifact was not found.", status: 404, retryable: false },
  invalid_origin: { message: "Artifact origin is invalid.", status: 400, retryable: false },
  insufficient_scope: { message: "Artifact permission is required.", status: 403, retryable: false },
  storage_unavailable: { message: "Artifact storage is temporarily unavailable.", status: 503, retryable: true },
  internal: { message: "Artifact request failed.", status: 500, retryable: true },
};

export class ArtifactError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(readonly code: ArtifactErrorCode) {
    super(ERROR_DETAILS[code].message);
    this.name = "ArtifactError";
    this.status = ERROR_DETAILS[code].status;
    this.retryable = ERROR_DETAILS[code].retryable;
    Object.setPrototypeOf(this, ArtifactError.prototype);
  }

  toPublic() {
    return { code: this.code, message: this.message, status: this.status, retryable: this.retryable };
  }
}

export type ArtifactPackageFile = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256?: string;
  content?: Uint8Array;
  zipUnixMode?: number;
  zipIsDirectory?: boolean;
};

export type ArtifactPackageInput = {
  type: Exclude<ArtifactType, "link">;
  source: ArtifactPackageSource;
  files: readonly ArtifactPackageFile[];
};

export type ValidatedArtifactFile = Omit<ArtifactPackageFile, "path"> & { path: string };

export type ArtifactManifestFile = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};
