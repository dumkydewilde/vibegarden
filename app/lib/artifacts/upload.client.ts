import type { PreparedArtifactPackage } from "./package.client";

export type UploadAcknowledgement = { path: string; byteSize: number; sha256: string };
export type UploadResumeState = {
  uploadId: string;
  artifactId: string;
  versionId: string;
  completed: UploadAcknowledgement[];
};

export type UploadPreparedPackageOptions = {
  project: { projectId: string } | { projectDraft: { title: string; oneLiner: string } };
  title: string;
  description?: string;
  allowedDataOrigins: string[];
  idempotencyKey: string;
  artifactId?: string;
  resume?: UploadResumeState;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  onProgress?: (progress: { completedFiles: number; completedBytes: number; totalFiles: number; totalBytes: number }) => void;
};

type UploadSession = Omit<UploadResumeState, "completed"> & {
  expiresAt: number;
  /** Recorded by the authenticated idempotent session response. */
  completed?: UploadAcknowledgement[];
};
type FinalizedUpload = { artifactId: string; versionId: string };
export type UploadPreparedPackageFailure = Error & { resume: UploadResumeState };

function abortError(): DOMException {
  return new DOMException("Upload was aborted.", "AbortError");
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Artifact upload failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function sameAcknowledgement(file: UploadAcknowledgement, expected: UploadAcknowledgement): boolean {
  return file.path === expected.path && file.byteSize === expected.byteSize && file.sha256 === expected.sha256;
}

function sameSessionIdentity(left: Omit<UploadResumeState, "completed">, right: Omit<UploadResumeState, "completed">): boolean {
  return left.uploadId === right.uploadId && left.artifactId === right.artifactId && left.versionId === right.versionId;
}

function serverConfirmedAcknowledgements(
  acknowledgements: readonly UploadAcknowledgement[] | undefined,
  prepared: PreparedArtifactPackage,
): UploadAcknowledgement[] {
  const confirmed: UploadAcknowledgement[] = [];
  for (const file of prepared.files) {
    const expected: UploadAcknowledgement = { path: file.path, byteSize: file.byteSize, sha256: file.sha256 };
    const acknowledgement = acknowledgements?.find((candidate) => sameAcknowledgement(candidate, expected));
    if (acknowledgement) confirmed.push(acknowledgement);
  }
  return confirmed;
}

function resumeState(session: UploadSession, completed: readonly UploadAcknowledgement[]): UploadResumeState {
  return {
    uploadId: session.uploadId,
    artifactId: session.artifactId,
    versionId: session.versionId,
    completed: [...completed],
  };
}

function attachResume(error: unknown, resume: UploadResumeState): never {
  const failure = error instanceof Error ? error : new Error("Artifact upload failed.", { cause: error });
  Object.assign(failure, { resume });
  throw failure as UploadPreparedPackageFailure;
}

/** Creates/resumes a single idempotent session and uploads its files one at a time. */
export async function uploadPreparedPackage(
  prepared: PreparedArtifactPackage,
  options: UploadPreparedPackageOptions,
): Promise<FinalizedUpload & { resume: UploadResumeState }> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const totalBytes = prepared.files.reduce((total, file) => total + file.byteSize, 0);
  let session: UploadSession | undefined;
  let completed: UploadAcknowledgement[] = [];
  let abortSent = false;

  const abort = async () => {
    if (!session || abortSent) return;
    abortSent = true;
    try {
      await fetcher(`/api/artifact-uploads/${encodeURIComponent(session.uploadId)}/abort`, { method: "POST", credentials: "same-origin" });
    } catch {
      // The local abort result must not be hidden by a best-effort server cleanup failure.
    }
  };
  const onAbort = () => { void abort(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (options.signal?.aborted) throw abortError();
    const createBody = {
      project: options.project,
      type: prepared.type,
      title: options.title,
      ...(options.description === undefined ? {} : { description: options.description }),
      allowedDataOrigins: options.allowedDataOrigins,
      idempotencyKey: options.idempotencyKey,
      ...(options.artifactId === undefined ? {} : { artifactId: options.artifactId }),
    };
    session = await json<UploadSession>(await fetcher("/api/artifact-uploads", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
      signal: options.signal,
    }));

    const suppliedResumeMatchesSession = options.resume === undefined || sameSessionIdentity(options.resume, session);
    // A caller can only name a prior session. Its paths are never trusted; a
    // matching identity permits use of paths recorded by the authenticated
    // idempotent session response. Stale state starts with no local skips.
    completed = suppliedResumeMatchesSession ? serverConfirmedAcknowledgements(session.completed, prepared) : [];
    let completedFiles = completed.length;
    let completedBytes = completed.reduce((total, file) => total + file.byteSize, 0);
    options.onProgress?.({ completedFiles, completedBytes, totalFiles: prepared.files.length, totalBytes });

    for (const file of prepared.files) {
      const expected: UploadAcknowledgement = { path: file.path, byteSize: file.byteSize, sha256: file.sha256 };
      if (completed.some((acknowledgement) => sameAcknowledgement(acknowledgement, expected))) continue;
      if (options.signal?.aborted) throw abortError();
      const acknowledgement = await json<UploadAcknowledgement>(await fetcher(
        `/api/artifact-uploads/${encodeURIComponent(session.uploadId)}/files`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "X-Artifact-Path": file.path,
            "X-Artifact-Mime": file.mimeType,
            "X-Artifact-Bytes": String(file.byteSize),
            "X-Artifact-SHA256": file.sha256,
          },
          body: file.blob,
          signal: options.signal,
        },
      ));
      if (!sameAcknowledgement(acknowledgement, expected)) throw new Error("Artifact upload acknowledgement did not match the prepared file.");
      completed.push(acknowledgement);
      completedFiles += 1;
      completedBytes += acknowledgement.byteSize;
      options.onProgress?.({ completedFiles, completedBytes, totalFiles: prepared.files.length, totalBytes });
    }

    if (options.signal?.aborted) throw abortError();
    const finalized = await json<FinalizedUpload>(await fetcher(
      `/api/artifact-uploads/${encodeURIComponent(session.uploadId)}/finalize`,
      { method: "POST", credentials: "same-origin", signal: options.signal },
    ));
    return { ...finalized, resume: resumeState(session, completed) };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) await abort();
    if (session && completed.length > 0) attachResume(error, resumeState(session, completed));
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
