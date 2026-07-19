const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isExactWebsiteOrigin(value: string): boolean {
  if (value.includes("*")) return false;

  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

function allowedWebsiteOrigins(env: Env): Set<string> {
  return new Set(
    env.WEB_ALLOWED_ORIGINS
      .split(",")
      .map((value) => value.trim())
      .filter(isExactWebsiteOrigin),
  );
}

/** Reject cross-site unsafe requests before website route code can run. */
export function assertWebsiteWriteOrigin(request: Request, env: Env): void {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("Origin");
  if (!origin || origin === "null" || !allowedWebsiteOrigins(env).has(origin)) {
    throw new Response("Forbidden", { status: 403 });
  }
}
