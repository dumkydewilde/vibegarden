export function safeInternalPath(
  request: Request,
  candidate: string | null | undefined,
  fallback = "/",
): string {
  if (!candidate) return fallback;
  const current = new URL(request.url);
  let destination: URL;
  try {
    destination = new URL(candidate, current.origin);
  } catch {
    return fallback;
  }
  if (destination.origin !== current.origin) return fallback;
  if (
    !destination.pathname.startsWith("/") ||
    destination.pathname.startsWith("//")
  ) {
    return fallback;
  }
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
