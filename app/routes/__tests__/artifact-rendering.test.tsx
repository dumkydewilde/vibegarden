import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import ArtifactDetailRoute from "../artifacts.$id";

const { requireArtifactUser, getOwnedArtifact, getGalleryArtifact } = vi.hoisted(() => ({
  requireArtifactUser: vi.fn(),
  getOwnedArtifact: vi.fn(),
  getGalleryArtifact: vi.fn(),
}));

vi.mock("~/lib/artifacts/auth.server", () => ({ requireArtifactUser }));
vi.mock("~/lib/artifacts/service.server", () => ({ getOwnedArtifact, getGalleryArtifact }));
vi.mock("~/lib/context", () => ({ cloudflareContext: Symbol("cloudflare") }));

const htmlVersion = {
  id: "version-current",
  number: 3,
  source: "web" as const,
  entryPath: "index.html",
  externalUrl: null,
  allowedDataOrigins: [],
  fileCount: 1,
  totalBytes: 12,
  createdAt: 0,
  files: [{ path: "index.html", mimeType: "text/html", byteSize: 12, sha256: "abc" }],
};

const htmlDetail = {
  access: "owner" as const,
  artifact: {
    id: "artifact-1",
    project: { id: "project-1", title: "A project" },
    title: "Interactive report",
    description: null,
    type: "html" as const,
    visibility: "private" as const,
    currentVersion: { id: "version-current", number: 3, source: "web" as const, createdAt: 0 },
    galleryVersion: { id: "version-shared", number: 2, source: "web" as const, createdAt: 0 },
    updatedAt: 0,
    url: "/artifacts/artifact-1",
    version: htmlVersion,
  },
  versions: [htmlVersion],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderHtmlDetail() {
  const Stub = createRoutesStub([
    { path: "/artifacts/:id", Component: ArtifactDetailRoute, loader: () => htmlDetail },
  ]);
  render(<Stub initialEntries={["/artifacts/artifact-1"]} />);
}

describe("ArtifactFrame", () => {
  it("embeds only a renderer capability URL in an exactly sandboxed iframe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://usercontent.vibegarden.club/v1/signed-capability/index.html",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }), { headers: { "Content-Type": "application/json" } })));

    renderHtmlDetail();

    const frame = await screen.findByTitle("Preview: Interactive report");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("src", "https://usercontent.vibegarden.club/v1/signed-capability/index.html");
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-downloads/);
    expect(screen.queryByRole("link", { name: /usercontent|open preview/i })).toBeNull();
    expect(screen.queryByText(/signed-capability/)).toBeNull();
  });

  it("refreshes an expired capability through the same-origin no-store loader", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: "https://usercontent.vibegarden.club/v1/expired/index.html",
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: "https://usercontent.vibegarden.club/v1/fresh/index.html",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    renderHtmlDetail();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/capability", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(await screen.findByTitle("Preview: Interactive report")).toHaveAttribute("src", "https://usercontent.vibegarden.club/v1/fresh/index.html");
  });
});

describe("artifact rendering wrappers", () => {
  it("uses a website full-screen wrapper instead of exposing a renderer entry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://usercontent.vibegarden.club/v1/capability/index.html",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }), { headers: { "Content-Type": "application/json" } })));
    renderHtmlDetail();

    expect(await screen.findByRole("link", { name: /open full screen/i })).toHaveAttribute("href", "/artifacts/artifact-1/fullscreen");
    expect(screen.queryByRole("link", { name: /usercontent|open preview/i })).toBeNull();
    expect(screen.getByTitle("Preview: Interactive report")).toHaveAttribute("sandbox", "allow-scripts");
  });
});

describe("preview capabilities", () => {
  it("mints an HTML claim from the owner current version, never the gallery pointer", async () => {
    requireArtifactUser.mockResolvedValue({ id: "viewer-1" });
    getOwnedArtifact.mockResolvedValue({
      id: "artifact-1",
      type: "html",
      version: htmlVersion,
      galleryVersion: { id: "version-shared", number: 2 },
    });
    const { loader } = await import("../api.artifacts.$artifactId.capability");

    const response = await loader({
      request: new Request("https://vibegarden.club/api/artifacts/artifact-1/capability"),
      params: { artifactId: "artifact-1" },
      context: { get: () => ({ env: {
        RENDERER_ORIGIN: "https://usercontent.vibegarden.club",
        RENDERER_SIGNING_SECRET: "renderer-secret",
        SESSION_SECRET: "session-secret",
      } }) },
    } as never);

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json() as { url: string; expiresAt: number };
    expect(body.url).toMatch(/^https:\/\/usercontent\.vibegarden\.club\/v1\//u);
    expect(body.url.endsWith("/index.html")).toBe(true);
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(getGalleryArtifact).not.toHaveBeenCalled();
  });

  it("falls back to the exact gallery version for a participant", async () => {
    requireArtifactUser.mockResolvedValue({ id: "viewer-2" });
    getOwnedArtifact.mockResolvedValue(null);
    getGalleryArtifact.mockResolvedValue({ id: "artifact-1", type: "html", version: { ...htmlVersion, id: "version-shared", number: 2 } });
    const { loader } = await import("../api.artifacts.$artifactId.capability");

    const response = await loader({
      request: new Request("https://vibegarden.club/api/artifacts/artifact-1/capability"),
      params: { artifactId: "artifact-1" },
      context: { get: () => ({ env: {
        RENDERER_ORIGIN: "https://usercontent.vibegarden.club",
        RENDERER_SIGNING_SECRET: "renderer-secret",
        SESSION_SECRET: "session-secret",
      } }) },
    } as never);

    expect(response.status).toBe(200);
    expect(getGalleryArtifact).toHaveBeenCalledWith(expect.anything(), "artifact-1");
    expect((await response.json() as { url: string }).url).toContain("usercontent.vibegarden.club/v1/");
  });
});
