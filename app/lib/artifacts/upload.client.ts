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

type UploadSession = Omit<UploadResumeState, "completed"> & { expiresAt: number };
type FinalizedUpload = { artifactId: string; versionId: string };

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

/** Creates/resumes a single idempotent session and uploads its files one at a time. */
export async function uploadPreparedPackage(
  prepared: PreparedArtifactPackage,
  options: UploadPreparedPackageOptions,
): Promise<FinalizedUpload & { resume: UploadResumeState }> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const totalBytes = prepared.files.reduce((total, file) => total + file.byteSize, 0);
  let session: UploadSession | undefined;
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

    const completed = [...(options.resume?.completed ?? [])];
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
    return { ...finalized, resume: { uploadId: session.uploadId, artifactId: session.artifactId, versionId: session.versionId, completed } };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) await abort();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
