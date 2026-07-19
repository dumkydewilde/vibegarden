import { normalizeArtifactOrigins } from "./validation";

const SCRIPT_HOSTS = ["https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://esm.sh"] as const;
const STYLE_HOSTS = [...SCRIPT_HOSTS, "https://fonts.googleapis.com"] as const;
const FONT_HOSTS = [...SCRIPT_HOSTS, "https://fonts.gstatic.com"] as const;

export type RendererAssetKind = "entry" | "asset" | "data" | "runtime";

export type RendererPolicyInput = {
  rendererOrigin: string;
  parentOrigin: string;
  allowedDataOrigins?: readonly string[];
  assetKind?: RendererAssetKind;
};

function normalizeRendererPolicyOrigin(value: string): string {
  if (typeof value !== "string") throw new Error("Renderer policy origin is invalid.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Renderer policy origin is invalid.");
  }
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if ((url.protocol !== "https:" && !localHttp) || !url.hostname || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Renderer policy origin is invalid.");
  }
  return url.origin;
}

function cspSources(...sources: readonly string[]): string {
  return sources.join(" ");
}

/** Builds server-owned CSP without accepting uploaded metadata or response headers. */
export function buildCsp(input: Omit<RendererPolicyInput, "assetKind">): string {
  normalizeRendererPolicyOrigin(input.rendererOrigin);
  const parentOrigin = normalizeRendererPolicyOrigin(input.parentOrigin);
  const allowedDataOrigins = normalizeArtifactOrigins(input.allowedDataOrigins ?? []);
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    `frame-ancestors ${parentOrigin}`,
    `script-src ${cspSources("'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...SCRIPT_HOSTS)}`,
    `style-src ${cspSources("'self'", "'unsafe-inline'", ...STYLE_HOSTS)}`,
    `img-src ${cspSources("'self'", "data:", "blob:", ...SCRIPT_HOSTS)}`,
    `font-src ${cspSources("'self'", "data:", ...FONT_HOSTS)}`,
    `media-src ${cspSources("'self'", "data:", "blob:", ...SCRIPT_HOSTS)}`,
    `worker-src ${cspSources("'self'", "blob:")}`,
    `connect-src ${cspSources("'self'", ...allowedDataOrigins)}`,
  ].join("; ");
}

/** Denies every browser capability that an artifact preview does not require. */
export function buildPermissionsPolicy(): string {
  return [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "clipboard-read=()",
    "clipboard-write=()",
    "payment=()",
    "usb=()",
    "bluetooth=()",
    "accelerometer=()",
    "ambient-light-sensor=()",
    "gyroscope=()",
    "magnetometer=()",
    "storage-access=()",
    "presentation=()",
    "screen-orientation=()",
    "pointer-lock=()",
  ].join(", ");
}

/** Returns fresh deterministic headers. Uploaded object metadata is never merged. */
export function buildRendererHeaders(input: RendererPolicyInput): Headers {
  const assetKind = input.assetKind ?? "entry";
  if (assetKind !== "entry" && assetKind !== "asset" && assetKind !== "data" && assetKind !== "runtime") {
    throw new Error("Renderer asset kind is invalid.");
  }
  const headers = new Headers({
    "Content-Security-Policy": buildCsp(input),
    "Permissions-Policy": buildPermissionsPolicy(),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
  });
  if (assetKind === "data" || assetKind === "runtime") headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}
