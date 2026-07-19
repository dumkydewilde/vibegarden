import { ArtifactError } from "./contracts";

const JSON_LIMIT_BYTES = 64 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function invalidInput(): never {
  throw new ArtifactError("invalid_input");
}

/** Reads a small JSON request body without allowing unbounded buffering. */
export async function readArtifactJson(request: Request): Promise<unknown> {
  if (!request.body) invalidInput();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > JSON_LIMIT_BYTES) throw new ArtifactError("limit_exceeded");
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    invalidInput();
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalidInput();
  }
}

/** Every browser artifact response is private and must never be stored. */
export function artifactJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return Response.json(value, { ...init, headers });
}

export function artifactEmpty(status = 204): Response {
  return new Response(null, { status, headers: NO_STORE_HEADERS });
}

/** Reject an unsupported verb before authentication, parsing, or delegation. */
export function artifactRequireMethod(request: Request, ...methods: string[]): Response | null {
  if (methods.includes(request.method)) return null;
  return artifactJson(new ArtifactError("invalid_input").toPublic(), { status: 400 });
}

/**
 * Converts only artifact-domain failures into stable JSON responses. Other
 * errors deliberately expose no implementation detail to the caller.
 */
export async function artifactJsonAction<T>(action: () => T | Promise<T>): Promise<T | Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ArtifactError) {
      return artifactJson(error.toPublic(), { status: error.status });
    }
    return artifactJson({ error: "internal_error" }, { status: 500 });
  }
}
