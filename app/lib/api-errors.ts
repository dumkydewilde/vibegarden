/** Converts route authorization responses into a stable resource API shape. */
export function apiAuthorizationError(error: unknown) {
  if (!(error instanceof Response)) throw error;

  const location = error.headers.get("Location");
  if (error.status === 302 && !location?.startsWith("/login")) {
    throw error;
  }

  const status = error.status === 302 ? 401 : error.status;
  const details = {
    401: { code: "unauthorized", message: "Authentication required." },
    403: { code: "forbidden", message: "Permission denied." },
    404: { code: "not_found", message: "Not found." },
  }[status];

  if (!details) throw error;
  return Response.json({ error: details }, { status });
}
