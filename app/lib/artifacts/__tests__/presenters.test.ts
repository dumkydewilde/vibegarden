import { describe, expect, it } from "vitest";

import {
  presentArtifactDetail,
  presentGalleryArtifact,
  presentOwnedArtifact,
} from "../presenters.server";

const artifact = {
  id: "artifact-1",
  projectId: "project-1",
  projectTitle: "Garden project",
  title: "  Tide chart  ",
  description: "  A small chart.  ",
  type: "html" as const,
  visibility: "gallery" as const,
  currentVersion: { id: "version-2", number: 2, source: "mcp" as const, createdAt: 200 },
  galleryVersion: { id: "version-1", number: 1, source: "web" as const, createdAt: 100 },
  updatedAt: 200,
};

const version = {
  ...artifact.galleryVersion,
  entryPath: "index.html",
  externalUrl: null,
  allowedDataOrigins: ["https://api.example.com"],
  fileCount: 1,
  totalBytes: 42,
  files: [{ path: "index.html", mimeType: "text/html", byteSize: 42, sha256: "a".repeat(64), r2Key: "artifacts/private" }],
};

describe("artifact presenters", () => {
  it("presents owner summaries with owned identifiers and stable authenticated URLs", () => {
    expect(presentOwnedArtifact(artifact)).toEqual({
      id: "artifact-1",
      project: { id: "project-1", title: "Garden project" },
      title: "  Tide chart  ",
      description: "  A small chart.  ",
      type: "html",
      visibility: "gallery",
      currentVersion: artifact.currentVersion,
      galleryVersion: artifact.galleryVersion,
      updatedAt: 200,
      url: "/artifacts/artifact-1",
    });
  });

  it("presents the exact gallery version and a display name without account identifiers", () => {
    const galleryRead = {
      id: "artifact-1",
      projectTitle: "Garden project",
      title: "  Tide chart  ",
      description: "  A small chart.  ",
      type: "html" as const,
      participantDisplayName: "Mina Garden",
      version: artifact.galleryVersion,
      updatedAt: 200,
    };
    // Gallery reads must be directly consumable and must not carry owner-only state.
    const gallery = presentGalleryArtifact(galleryRead);
    expect(gallery).toEqual({
      id: "artifact-1",
      project: { title: "Garden project" },
      title: "  Tide chart  ",
      description: "  A small chart.  ",
      type: "html",
      participant: { displayName: "Mina Garden" },
      version: artifact.galleryVersion,
      updatedAt: 200,
      url: "/artifacts/artifact-1",
    });
    expect(JSON.stringify(galleryRead)).not.toMatch(/projectId|user|email|currentVersion|version-2/i);
    expect(JSON.stringify(gallery)).not.toMatch(/user|email|version-2/i);
  });

  it("presents detail files and normalized origins without storage, leases, or claims", () => {
    const detail = presentArtifactDetail({ ...artifact, version });
    expect(detail.version).toEqual({
      id: "version-1",
      number: 1,
      source: "web",
      entryPath: "index.html",
      externalUrl: null,
      allowedDataOrigins: ["https://api.example.com"],
      fileCount: 1,
      totalBytes: 42,
      createdAt: 100,
      files: [{ path: "index.html", mimeType: "text/html", byteSize: 42, sha256: "a".repeat(64) }],
    });
    expect(JSON.stringify(detail)).not.toMatch(/r2|lease|claim|artifacts\/private/i);
  });
});
