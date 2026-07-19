import type { Route } from "./+types/api.artifact-uploads.$uploadId.files";
import { ARTIFACT_LIMITS, ArtifactError } from "~/lib/artifacts/contracts";
import { artifactJson, artifactJsonAction, artifactRejectMethod, artifactRequireMethod } from "~/lib/artifacts/http.server";
import { putUploadFile } from "~/lib/artifacts/service.server";
import { requireArtifactUser } from "~/lib/artifacts/auth.server";
import { cloudflareContext } from "~/lib/context";

const HEADER_NAMES = ["x-artifact-path", "x-artifact-mime", "x-artifact-bytes", "x-artifact-sha256"] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

function inputError(): never {
  throw new ArtifactError("invalid_input");
}

/**
 * Leaves the request body streaming while making an underdeclared upload fail
 * as soon as it crosses its declared size. The route never materializes the
 * body, and the service still performs the stored-size/checksum verification.
 */
function boundedBody(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let bytes = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        controller.error(new ArtifactError("invalid_input"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

function uploadHeaders(request: Request) {
  const artifactHeaders = [...request.headers.keys()].filter((name) => name.startsWith("x-artifact-"));
  if (artifactHeaders.length !== HEADER_NAMES.length || HEADER_NAMES.some((name) => !request.headers.has(name))) inputError();
  const path = request.headers.get("x-artifact-path");
  const mimeType = request.headers.get("x-artifact-mime");
  const declaredBytes = request.headers.get("x-artifact-bytes");
  const sha256 = request.headers.get("x-artifact-sha256");
  if (!path || !mimeType || !declaredBytes || !sha256 || !/^(?:0|[1-9][0-9]*)$/u.test(declaredBytes) || !SHA256.test(sha256)) inputError();
  const byteSize = Number(declaredBytes);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || mimeType.length > 128) inputError();
  return { path, mimeType, byteSize, sha256 };
}

export function loader() {
  return artifactRejectMethod();
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const methodError = artifactRequireMethod(request, "PUT");
  if (methodError) return methodError;
  const { env } = context.get(cloudflareContext);
  const user = await requireArtifactUser(env, request);
  if (user instanceof Response) return user;
  return artifactJsonAction(async () => {
    if (!params.uploadId || !request.body) inputError();
    const input = uploadHeaders(request);
    if (input.byteSize > ARTIFACT_LIMITS.browserBytes) inputError();
    const stored = await putUploadFile(env, user.id, params.uploadId, input, boundedBody(request.body, input.byteSize));
    return artifactJson({ path: stored.path, byteSize: stored.byteSize, sha256: stored.sha256 });
  });
}
