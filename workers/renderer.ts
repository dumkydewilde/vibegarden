import { verifyCapability, type RendererCapability } from "../app/lib/artifacts/capability";
import { buildRendererHeaders, type RendererAssetKind } from "../app/lib/artifacts/policy";
import { normalizeArtifactPath } from "../app/lib/artifacts/validation";

const RUNTIME_PREFIX = "/runtime/duckdb/1.33.1-dev57.0/";
const RUNTIME_FILES = new Set(["duckdb-browser-eh.worker.js", "duckdb-eh.wasm"]);
const DATA_EXTENSIONS = new Set([".json", ".csv", ".tsv", ".parquet"]);
const CORS_ASSET_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf"]);
const PRIVATE_CACHE_CONTROL = "private, no-store";
const RUNTIME_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type RendererEnv = {
  ARTIFACTS: R2Bucket;
  ASSETS: Fetcher;
  ARTIFACT_METRICS: AnalyticsEngineDataset;
  RENDERER_SIGNING_SECRET: string;
  PARENT_ORIGIN: string;
};

function privateError(status: 403 | 404 | 405): Response {
  const body = status === 403 ? "Forbidden" : status === 405 ? "Method Not Allowed" : "Not Found";
  return new Response(body, { status, headers: { "Cache-Control": PRIVATE_CACHE_CONTROL, "Content-Type": "text/plain; charset=utf-8" } });
}

function rendererOrigin(url: URL): string {
  return url.origin;
}

function isDataPath(path: string): boolean {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  return lastDot > lastSlash && DATA_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

function isCorsAssetPath(path: string): boolean {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  return lastDot > lastSlash && CORS_ASSET_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

function assetKind(path: string, capability: RendererCapability): RendererAssetKind {
  if (path === capability.entryPath) return "entry";
  return isDataPath(path) || isCorsAssetPath(path) ? "data" : "asset";
}

function previewEntryRequestIsAllowed(request: Request, path: string, capability: RendererCapability): boolean {
  if (capability.mode !== "preview" || path !== capability.entryPath) return true;
  return request.headers.get("Sec-Fetch-Dest") === "iframe" && request.headers.get("Sec-Fetch-Mode") === "navigate";
}

function parseCapabilityPath(url: URL): { token: string; path: string } | null {
  const prefix = "/v1/";
  if (!url.pathname.startsWith(prefix)) return null;
  const remainder = url.pathname.slice(prefix.length);
  const separator = remainder.indexOf("/");
  if (separator <= 0 || separator === remainder.length - 1) return null;
  const token = remainder.slice(0, separator);
  try {
    const path = decodeURIComponent(remainder.slice(separator + 1));
    return { token, path: normalizeArtifactPath(path) };
  } catch {
    return null;
  }
}

function attachmentName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9._-]/gu, "_");
}

async function runtimeResponse(request: Request, env: RendererEnv, url: URL): Promise<Response> {
  const file = url.pathname.slice(RUNTIME_PREFIX.length);
  if (!RUNTIME_FILES.has(file) || file.includes("/")) return privateError(404);

  try {
    const asset = await env.ASSETS.fetch(new Request(new URL(url.pathname, request.url)));
    if (!asset.ok) return privateError(404);
    const headers = buildRendererHeaders({ rendererOrigin: rendererOrigin(url), parentOrigin: env.PARENT_ORIGIN, assetKind: "runtime" });
    headers.set("Cache-Control", RUNTIME_CACHE_CONTROL);
    const contentType = asset.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    return new Response(asset.body, { status: 200, headers });
  } catch {
    return privateError(404);
  }
}

async function artifactResponse(request: Request, env: RendererEnv, url: URL): Promise<Response> {
  const parsed = parseCapabilityPath(url);
  if (!parsed) return privateError(404);
  const capability = await verifyCapability(parsed.token, { rendererSigningSecret: env.RENDERER_SIGNING_SECRET });
  if (!capability) return privateError(403);
  if (capability.mode === "download" && parsed.path !== capability.entryPath) return privateError(404);
  if (!previewEntryRequestIsAllowed(request, parsed.path, capability)) return privateError(403);

  let object: R2ObjectBody | null;
  try {
    object = await env.ARTIFACTS.get(`${capability.prefix}/${parsed.path}`);
  } catch {
    return privateError(404);
  }
  if (!object) return privateError(404);

  const headers = buildRendererHeaders({
    rendererOrigin: rendererOrigin(url),
    parentOrigin: env.PARENT_ORIGIN,
    allowedDataOrigins: capability.allowedDataOrigins,
    assetKind: assetKind(parsed.path, capability),
  });
  if (object.httpMetadata?.contentType) headers.set("Content-Type", object.httpMetadata.contentType);
  if (capability.mode === "download") headers.set("Content-Disposition", `attachment; filename="${attachmentName(capability.entryPath)}"`);
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env: RendererEnv): Promise<Response> {
    if (request.method !== "GET") return privateError(405);
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith(RUNTIME_PREFIX)) return runtimeResponse(request, env, url);
      if (url.pathname.startsWith("/v1/")) return artifactResponse(request, env, url);
      return privateError(404);
    } catch {
      return privateError(404);
    }
  },
} satisfies ExportedHandler<RendererEnv>;
