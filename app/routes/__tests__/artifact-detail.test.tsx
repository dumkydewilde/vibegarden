import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import ArtifactDetailRoute from "../artifacts.$id";

const version = {
  id: "version-1",
  number: 1,
  source: "web" as const,
  entryPath: null,
  externalUrl: "https://example.com/a",
  allowedDataOrigins: ["https://data.example.com"],
  fileCount: 0,
  totalBytes: 0,
  createdAt: 0,
  files: [{ path: "report.csv", mimeType: "text/csv", byteSize: 12, sha256: "abc" }],
};

const owner = {
  access: "owner" as const,
  artifact: {
    id: "artifact-1",
    project: { id: "project-1", title: "A project" },
    title: "A link",
    description: "A useful link",
    type: "link" as const,
    visibility: "gallery" as const,
    currentVersion: { id: "version-1", number: 1, source: "web" as const, createdAt: 0 },
    galleryVersion: { id: "version-1", number: 1, source: "web" as const, createdAt: 0 },
    updatedAt: 0,
    url: "/artifacts/artifact-1",
    version,
  },
  versions: [version],
};

function renderDetail(data: unknown) {
  const Stub = createRoutesStub([
    { path: "/artifacts/:id", Component: ArtifactDetailRoute, loader: () => data },
  ]);
  render(<Stub initialEntries={["/artifacts/artifact-1"]} />);
}

describe("Artifact detail", () => {
  it("shows owner controls and allowed origins at the bottom of the detail page", async () => {
    renderDetail(owner);

    expect(await screen.findByText("Allowed data origins")).toBeInTheDocument();
    expect(screen.getByText("https://data.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit metadata/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new version/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove from gallery/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete artifact/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open external link/i })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("region").at(-1)).toHaveAccessibleName("Allowed data origins");
  });

  it("hides allowed data origins when the current version declares none", async () => {
    renderDetail({
      ...owner,
      artifact: { ...owner.artifact, version: { ...version, allowedDataOrigins: [] } },
    });

    expect(await screen.findByRole("heading", { name: "Artifact" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Allowed data origins" })).not.toBeInTheDocument();
  });

  it("places the primary fullscreen control in the artifact header", async () => {
    renderDetail({
      access: "gallery",
      artifact: {
        ...owner.artifact,
        type: "html",
        version: { ...version, entryPath: "index.html", externalUrl: null },
      },
    });

    const artifactHeading = await screen.findByRole("heading", { name: "Artifact" });
    const fullscreenLink = screen.getByRole("link", { name: "Open fullscreen" });
    expect(fullscreenLink).toHaveAttribute("data-variant", "default");
    expect(artifactHeading.parentElement).toContainElement(fullscreenLink);
  });

  it("keeps gallery readers out of owner controls and does not embed files inline", async () => {
    renderDetail({
      access: "gallery",
      artifact: {
        ...owner.artifact,
        version: { ...version, externalUrl: null },
      },
    });

    expect(await screen.findByText(/shared in the gallery/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit metadata/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete artifact/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/preview/i)).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /download report\.csv/i })).toHaveAttribute("href", "/artifacts/artifact-1/download?path=report.csv");
  });

  it("keeps an owner-recoverable deletion visible after a detail reload", async () => {
    renderDetail({
      ...owner,
      artifact: { ...owner.artifact, deletedAt: Date.UTC(2026, 6, 18) },
    });

    expect(await screen.findByRole("heading", { name: "Artifact deleted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recover artifact/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new version/i })).not.toBeInTheDocument();
  });
});
