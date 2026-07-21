import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { issueCapability, type RendererCapability } from "../../app/lib/artifacts/capability";
import renderer from "../../workers/renderer";
import forbidden from "../security/fixtures/forbidden.html?raw";

const rendererOrigin = "https://usercontent.vibegarden.club";
const parentOrigin = "https://vibegarden.club";
const signingSecret = "test-renderer-signing-secret";
const sessionSecret = "test-session-secret";
const prefix = "artifacts/artifact-1/versions/version-1";
const runtimePrefix = "runtime/duckdb/1.33.1-dev57.0";
const now = Math.floor(Date.now() / 1000);

type RendererEnv = Pick<Env, "ARTIFACTS" | "ARTIFACT_METRICS"> & {
  RENDERER_SIGNING_SECRET: string;
  PARENT_ORIGIN: string;
};

const rendererEnv: RendererEnv = {
  ARTIFACTS: env.ARTIFACTS,
  ARTIFACT_METRICS: env.ARTIFACT_METRICS,
  RENDERER_SIGNING_SECRET: signingSecret,
  PARENT_ORIGIN: parentOrigin,
};

function capability(patch: Partial<RendererCapability> = {}): Promise<string> {
  const claims: RendererCapability = {
    tokenVersion: 1,
    policyVersion: 1,
    mode: "preview",
    versionId: "version-1",
    prefix,
    entryPath: "index.html",
    allowedDataOrigins: ["https://data.example.com"],
    exp: now + 300,
    ...patch,
  };
  return issueCapability(claims, { rendererSigningSecret: signingSecret, sessionSecret }, { now });
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return renderer.fetch(
    new Request(`${rendererOrigin}${path}`, init),
    rendererEnv,
    {} as ExecutionContext,
  );
}

function rendererPath(token: string, relativePath: string): string {
  return `/v1/${token}/${relativePath}`;
}

async function put(relativePath: string, body: BodyInit, options: R2PutOptions = {}): Promise<void> {
  await env.ARTIFACTS.put(`${prefix}/${relativePath}`, body, options);
}

function previewInit(headers: HeadersInit = {}): RequestInit {
  return {
    headers: {
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      ...headers,
    },
  };
}

function expectFixedError(response: Response, body: string): void {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(body).not.toContain(prefix);
  expect(body).not.toContain("capability");
  expect(body).not.toContain("stack");
}

describe("isolated artifact renderer", () => {
  it("serves preview entries, relative assets, and CORS-enabled data through signed capabilities", async () => {
    await put("index.html", "<h1>Preview</h1>", { httpMetadata: { contentType: "text/html" } });
    await put("assets/app.js", "export const preview = true", { httpMetadata: { contentType: "text/javascript" } });
    await put("data/results.json", '{"ok":true}', { httpMetadata: { contentType: "application/json" } });
    const token = await capability();

    const entry = await request(rendererPath(token, "index.html"), previewInit());
    const asset = await request(rendererPath(token, "assets/app.js"));
    const data = await request(rendererPath(token, "data/results.json"));

    expect(entry.status).toBe(200);
    expect(await entry.text()).toBe("<h1>Preview</h1>");
    expect(entry.headers.get("Content-Type")).toBe("text/html");
    expect(entry.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(entry.headers.get("Content-Security-Policy")).toContain(`frame-ancestors ${parentOrigin}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(data.status).toBe(200);
    expect(data.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(data.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("CORS-enables packaged fonts for an opaque sandboxed preview", async () => {
    await put("assets/fixture.woff2", new Uint8Array([0, 1, 0, 0]), { httpMetadata: { contentType: "font/woff2" } });
    const token = await capability();

    const font = await request(rendererPath(token, "assets/fixture.woff2"));

    expect(font.status).toBe(200);
    expect(font.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("serves download capabilities only at their signed entry as an attachment", async () => {
    await put("report.csv", "name,value\nDuck,1\n", { httpMetadata: { contentType: "text/csv" } });
    await put('reports/report "draft".csv', "name,value\nDuck,1\n", { httpMetadata: { contentType: "text/csv" } });
    await put("other.txt", "not downloadable", { httpMetadata: { contentType: "text/plain" } });
    const token = await capability({ mode: "download", entryPath: "report.csv", allowedDataOrigins: [] });
    const quotedNameToken = await capability({ mode: "download", entryPath: 'reports/report "draft".csv', allowedDataOrigins: [] });

    const download = await request(rendererPath(token, "report.csv"));
    const quotedName = await request(rendererPath(quotedNameToken, 'reports/report "draft".csv'));
    const other = await request(rendererPath(token, "other.txt"));

    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toBe('attachment; filename="report.csv"');
    expect(quotedName.headers.get("Content-Disposition")).toBe('attachment; filename="report__draft_.csv"');
    expect(download.headers.get("Content-Type")).toBe("text/csv");
    expect(other.status).toBe(404);
    expectFixedError(other, await other.text());
  });

  it("rejects expired, tampered, and non-normalized capability requests without leaking bearer data", async () => {
    const valid = await capability();
    const expired = await issueCapability(
      {
        tokenVersion: 1,
        policyVersion: 1,
        mode: "preview",
        versionId: "version-1",
        prefix,
        entryPath: "index.html",
        allowedDataOrigins: [],
        exp: now - 1,
      },
      { rendererSigningSecret: signingSecret, sessionSecret },
      { now: now - 301 },
    );
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;

    for (const path of [
      rendererPath(expired, "index.html"),
      rendererPath(tampered, "index.html"),
      rendererPath(valid, "%2E%2E/secret.txt"),
    ]) {
      const response = await request(path, previewInit());
      expect([403, 404]).toContain(response.status);
      expectFixedError(response, await response.text());
    }
  });

  it("requires iframe navigation metadata for preview entries", async () => {
    await put("index.html", "<h1>Preview</h1>", { httpMetadata: { contentType: "text/html" } });
    const token = await capability();

    const topLevel = await request(rendererPath(token, "index.html"), {
      headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate" },
    });
    const missingMetadata = await request(rendererPath(token, "index.html"));

    expect(topLevel.status).toBe(403);
    expect(missingMetadata.status).toBe(403);
    expectFixedError(topLevel, await topLevel.text());
    expectFixedError(missingMetadata, await missingMetadata.text());
  });

  it("keeps uploaded policy attempts and wrong-secret capabilities out of renderer responses", async () => {
    await put("index.html", forbidden, {
      httpMetadata: {
        contentType: "text/html",
        cacheControl: "public, max-age=31536000",
        contentDisposition: "attachment; filename=evil.html",
      },
      customMetadata: {
        "Content-Security-Policy": "default-src *",
        "Access-Control-Allow-Origin": "https://evil.example",
      },
    });
    const goodToken = await capability();
    const wrongSecretToken = await issueCapability(
      {
        tokenVersion: 1,
        policyVersion: 1,
        mode: "preview",
        versionId: "version-1",
        prefix,
        entryPath: "index.html",
        allowedDataOrigins: [],
        exp: now + 300,
      },
      { rendererSigningSecret: "wrong-renderer-signing-secret", sessionSecret },
      { now },
    );

    const response = await request(rendererPath(goodToken, "index.html"), previewInit());
    const rejected = await request(rendererPath(wrongSecretToken, "index.html"), previewInit());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(forbidden);
    expect(response.headers.get("Content-Security-Policy")).not.toContain("https://evil.example");
    expect(response.headers.get("Content-Security-Policy")).toContain(`frame-ancestors ${parentOrigin}`);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(rejected.status).toBe(403);
    expectFixedError(rejected, await rejected.text());
  });

  it("serves only the pinned runtime files with immutable caching", async () => {
    await env.ARTIFACTS.put(`${runtimePrefix}/duckdb-browser-eh.worker.js`, "duckdb worker", {
      httpMetadata: { contentType: "text/javascript" },
    });
    await env.ARTIFACTS.put(`${runtimePrefix}/duckdb-eh.wasm`, new Uint8Array([0, 97, 115, 109]), {
      httpMetadata: { contentType: "application/wasm" },
    });

    const worker = await request("/runtime/duckdb/1.33.1-dev57.0/duckdb-browser-eh.worker.js");
    const wasm = await request("/runtime/duckdb/1.33.1-dev57.0/duckdb-eh.wasm");
    const rejected = await request("/runtime/duckdb/1.33.1-dev57.0/duckdb-browser-mvp.worker.js");

    expect(worker.status).toBe(200);
    expect(worker.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(worker.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(rejected.status).toBe(404);
    expectFixedError(rejected, await rejected.text());
  });
});
