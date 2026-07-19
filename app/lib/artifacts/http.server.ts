import { ArtifactError } from "./contracts";

/**
 * Converts only artifact-domain failures into stable JSON responses. Other
 * errors deliberately expose no implementation detail to the caller.
 */
export async function artifactJsonAction<T>(action: () => T | Promise<T>): Promise<T | Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ArtifactError) {
      return Response.json(error.toPublic(), { status: error.status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
