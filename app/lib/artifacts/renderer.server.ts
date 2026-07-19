import { ArtifactError, ARTIFACT_LIMITS, type ArtifactType } from "./contracts";
import { issueCapability } from "./capability";
import { getGalleryArtifact, getOwnedArtifact } from "./service.server";

type VisibleArtifact = {
  id: string;
  title: string;
  type: ArtifactType;
  version: {
    id: string;
    entryPath: string | null;
    allowedDataOrigins: string[];
    files: Array<{ path: string }>;
  };
};

export async function resolveVisibleArtifact(env: Env, userId: string, artifactId: string): Promise<VisibleArtifact | null> {
  const owned = await getOwnedArtifact(env, userId, artifactId);
  return owned ?? await getGalleryArtifact(env, artifactId);
}

function rendererAssetUrl(rendererOrigin: string, token: string, path: string): string {
  const origin = new URL(rendererOrigin).origin;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/v1/${token}/${encodedPath}`, origin).toString();
}

export async function issueRendererCapability(
  env: Env,
  artifact: VisibleArtifact,
  mode: "preview" | "download",
  entryPath: string,
) {
  if (artifact.type === "link") throw new ArtifactError("invalid_type");
  if (mode === "preview" && (artifact.type !== "html" || artifact.version.entryPath !== entryPath)) {
    throw new ArtifactError("invalid_type");
  }
  if (mode === "download" && (artifact.type !== "file" || !artifact.version.files.some((file) => file.path === entryPath))) {
    throw new ArtifactError("not_found");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ARTIFACT_LIMITS.capabilityTtlSeconds;
  const token = await issueCapability({
    tokenVersion: 1,
    policyVersion: 1,
    mode,
    versionId: artifact.version.id,
    prefix: `artifacts/${artifact.id}/versions/${artifact.version.id}`,
    entryPath,
    allowedDataOrigins: artifact.version.allowedDataOrigins,
    exp: expiresAt,
  }, {
    rendererSigningSecret: env.RENDERER_SIGNING_SECRET,
    sessionSecret: env.SESSION_SECRET,
  }, { now });
  return { url: rendererAssetUrl(env.RENDERER_ORIGIN, token, entryPath), expiresAt };
}
