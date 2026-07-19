import type { ArtifactType } from "./contracts";

export type ArtifactVersionSummary = {
  id: string;
  number: number;
  source: "web" | "mcp";
  createdAt: number;
};

export type ArtifactFile = {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type ArtifactVersionDetail = ArtifactVersionSummary & {
  entryPath: string | null;
  externalUrl: string | null;
  allowedDataOrigins: string[];
  fileCount: number;
  totalBytes: number;
  files: ArtifactFile[];
};

export type ArtifactPresentation = {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  description: string | null;
  type: ArtifactType;
  visibility: "private" | "gallery";
  currentVersion: ArtifactVersionSummary | null;
  galleryVersion: ArtifactVersionSummary | null;
  updatedAt: number;
};

export type ArtifactDetailPresentation = ArtifactPresentation & {
  version: ArtifactVersionDetail;
  deletedAt?: number | null;
};

/**
 * Gallery reads deliberately carry only the fields a participant may see.
 * It is also the direct input contract for the gallery presenter.
 */
export type GalleryArtifactPresentation = {
  id: string;
  projectTitle: string;
  title: string;
  description: string | null;
  type: ArtifactType;
  participantDisplayName: string;
  version: ArtifactVersionSummary;
  updatedAt: number;
};

export type GalleryArtifactDetailPresentation = Omit<GalleryArtifactPresentation, "version"> & {
  version: ArtifactVersionDetail;
};

function artifactUrl(id: string): string {
  return `/artifacts/${encodeURIComponent(id)}`;
}

/** Owner list data is intentionally the only list shape that includes owned IDs. */
export function presentOwnedArtifact(artifact: ArtifactPresentation) {
  return {
    id: artifact.id,
    project: { id: artifact.projectId, title: artifact.projectTitle },
    title: artifact.title,
    description: artifact.description,
    type: artifact.type,
    visibility: artifact.visibility,
    currentVersion: artifact.currentVersion,
    galleryVersion: artifact.galleryVersion,
    updatedAt: artifact.updatedAt,
    url: artifactUrl(artifact.id),
  };
}

/** Gallery cards are deliberately limited to the exact gallery version. */
export function presentGalleryArtifact(artifact: GalleryArtifactPresentation) {
  return {
    id: artifact.id,
    project: { title: artifact.projectTitle },
    title: artifact.title,
    description: artifact.description,
    type: artifact.type,
    participant: { displayName: artifact.participantDisplayName },
    version: artifact.version,
    updatedAt: artifact.updatedAt,
    url: artifactUrl(artifact.id),
  };
}

function presentVersion(version: ArtifactVersionDetail) {
  return {
    id: version.id,
    number: version.number,
    source: version.source,
    entryPath: version.entryPath,
    externalUrl: version.externalUrl,
    allowedDataOrigins: version.allowedDataOrigins,
    fileCount: version.fileCount,
    totalBytes: version.totalBytes,
    createdAt: version.createdAt,
    files: version.files.map(({ path, mimeType, byteSize, sha256 }) => ({ path, mimeType, byteSize, sha256 })),
  };
}

/** Detail output deliberately omits storage keys, upload leases, and renderer claims. */
export function presentArtifactDetail(artifact: ArtifactDetailPresentation) {
  return {
    ...presentOwnedArtifact(artifact),
    ...(artifact.deletedAt === undefined ? {} : { deletedAt: artifact.deletedAt }),
    version: presentVersion(artifact.version),
  };
}

export function presentArtifactVersion(version: ArtifactVersionDetail) {
  return presentVersion(version);
}
