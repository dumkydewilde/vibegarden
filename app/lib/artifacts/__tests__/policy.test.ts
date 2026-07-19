import { describe, expect, it } from "vitest";

import { buildCsp, buildPermissionsPolicy, buildRendererHeaders } from "../policy";

const rendererOrigin = "https://usercontent.vibegarden.club";
const parentOrigin = "https://vibegarden.club";

describe("renderer policy", () => {
  it("builds deterministic CSP from only normalized declared data origins", () => {
    expect(buildCsp({ rendererOrigin, parentOrigin, allowedDataOrigins: [] })).toMatchInlineSnapshot(`"default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; frame-ancestors https://vibegarden.club; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://fonts.googleapis.com; img-src 'self' data: blob: https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; font-src 'self' data: https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://fonts.gstatic.com; media-src 'self' data: blob: https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; worker-src 'self' blob:; connect-src 'self'"`);
    expect(buildCsp({ rendererOrigin, parentOrigin, allowedDataOrigins: ["https://api.example.com"] })).toContain(
      "connect-src 'self' https://api.example.com",
    );
    expect(buildCsp({ rendererOrigin, parentOrigin, allowedDataOrigins: ["https://B.example", "https://a.example:443"] }))
      .toContain("connect-src 'self' https://a.example https://b.example");
  });

  it("uses explicit production and development parent origins", () => {
    expect(buildCsp({ rendererOrigin, parentOrigin })).toContain("frame-ancestors https://vibegarden.club");
    expect(buildCsp({ rendererOrigin: "http://localhost:8787", parentOrigin: "http://localhost:5173" }))
      .toContain("frame-ancestors http://localhost:5173");
    expect(buildCsp({ rendererOrigin: "http://usercontent.vibegarden.test:8788", parentOrigin: "http://vibegarden.test:8788" }))
      .toContain("frame-ancestors http://vibegarden.test:8788");
  });

  it("never emits wildcard frame or connect policy", () => {
    const csp = buildCsp({ rendererOrigin, parentOrigin, allowedDataOrigins: ["https://api.example.com"] });

    expect(csp).not.toMatch(/frame-ancestors[^;]*\*/);
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
  });

  it("denies unneeded hardware and storage capabilities", () => {
    expect(buildPermissionsPolicy()).toBe(
      "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), bluetooth=(), accelerometer=(), ambient-light-sensor=(), gyroscope=(), magnetometer=(), storage-access=(), presentation=(), screen-orientation=(), pointer-lock=()",
    );
  });

  it("builds fresh immutable capability headers and only CORS-enables data/runtime assets", () => {
    const entry = buildRendererHeaders({ rendererOrigin, parentOrigin, assetKind: "entry" });
    const data = buildRendererHeaders({ rendererOrigin, parentOrigin, assetKind: "data" });
    const runtime = buildRendererHeaders({ rendererOrigin, parentOrigin, assetKind: "runtime" });

    for (const headers of [entry, data, runtime]) {
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(headers.get("Cache-Control")).toBe("private, no-store");
      expect(headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    }
    expect(entry.get("Access-Control-Allow-Origin")).toBeNull();
    expect(data.get("Access-Control-Allow-Origin")).toBe("*");
    expect(runtime.get("Access-Control-Allow-Origin")).toBe("*");
    entry.set("X-Uploaded-Header", "ignored");
    expect(buildRendererHeaders({ rendererOrigin, parentOrigin, assetKind: "entry" }).get("X-Uploaded-Header")).toBeNull();
  });
});
