export function presentArtifactMutation(
  appOrigin: string,
  clubSlug: string,
  result: { artifactId: string; versionId: string },
  visibility: "private" | "gallery",
) {
  return {
    artifact_id: result.artifactId,
    version_id: result.versionId,
    visibility,
    url: new URL(
      `/clubs/${encodeURIComponent(clubSlug)}/artifacts/${encodeURIComponent(result.artifactId)}`,
      appOrigin,
    ).toString(),
  };
}
