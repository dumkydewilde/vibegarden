import { describe, expect, it, vi } from "vitest";
import { recordArtifactEvent, writeArtifactMetric } from "../observability.server";

describe("artifact observability", () => {
  it("emits only allowlisted log and metric fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const writeDataPoint = vi.fn();
    const env = { ARTIFACT_METRICS: { writeDataPoint } } as unknown as Env;

    recordArtifactEvent({
      operation: "cleanup",
      artifactId: "artifact-1",
      uploadId: "upload-1",
      count: 2,
      bytes: 42,
      outcome: "partial_failure",
      errorCode: "storage_unavailable",
      r2Key: "artifacts/private/source.html",
      path: "private/source.html",
      content: "private source",
      token: "secret-token",
      email: "person@example.com",
    } as never);
    writeArtifactMetric(env, {
      operation: "cleanup",
      count: 2,
      bytes: 42,
      outcome: "partial_failure",
      errorCode: "storage_unavailable",
      r2Key: "artifacts/private/source.html",
      path: "private/source.html",
      content: "private source",
      token: "secret-token",
      email: "person@example.com",
    } as never);

    expect(info).toHaveBeenCalledWith("artifact_event", {
      operation: "cleanup",
      artifactId: "artifact-1",
      uploadId: "upload-1",
      count: 2,
      bytes: 42,
      outcome: "partial_failure",
      errorCode: "storage_unavailable",
    });
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["cleanup", "partial_failure", "storage_unavailable"],
      doubles: [2, 42, 0],
    });
    expect(JSON.stringify([info.mock.calls, writeDataPoint.mock.calls])).not.toMatch(
      /artifacts\/private|source\.html|private source|secret-token|person@example\.com/i,
    );
  });
});
