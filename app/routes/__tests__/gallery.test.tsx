import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Gallery from "../gallery";

const sharedArtifact = {
  id: "artifact-1",
  project: { title: "Data stories" },
  title: "Bird count explorer",
  description: "A shared view of local sightings.",
  type: "html" as const,
  participant: { displayName: "Avery" },
  version: { id: "version-shared", number: 2, source: "web" as const, createdAt: 0 },
  updatedAt: 0,
  url: "/artifacts/artifact-1",
};

function renderGallery(artifacts = [sharedArtifact]) {
  const Stub = createRoutesStub([
    { path: "/gallery", Component: Gallery, loader: () => ({ artifacts }) },
  ]);
  render(<Stub initialEntries={["/gallery"]} />);
}

describe("Gallery", () => {
  it("shows the exact shared version as a selectable card without loading an iframe", async () => {
    renderGallery();

    expect(await screen.findByRole("link", { name: /bird count explorer/i })).toHaveAttribute("href", "/artifacts/artifact-1");
    expect(screen.getByText("Data stories")).toBeInTheDocument();
    expect(screen.getByText(/by avery/i)).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("keeps the empty state when no exact gallery shares are available", async () => {
    renderGallery([]);
    expect(await screen.findByText(/gallery is still empty/i)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
