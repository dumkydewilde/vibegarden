import type { ServerBuild } from "react-router";
import * as artifactUploads from "~/routes/api.artifact-uploads";
import * as artifactUploadFiles from "~/routes/api.artifact-uploads.$uploadId.files";
import * as artifactUploadFinalize from "~/routes/api.artifact-uploads.$uploadId.finalize";
import * as artifactUploadAbort from "~/routes/api.artifact-uploads.$uploadId.abort";
import * as artifactLinks from "~/routes/api.artifacts.links";
import * as artifactLinkVersion from "~/routes/api.artifacts.$artifactId.link-version";
import * as artifactResource from "~/routes/api.artifacts.$artifactId";
import * as artifactRestoreVersion from "~/routes/api.artifacts.$artifactId.restore-version";
import * as artifactGallery from "~/routes/api.artifacts.$artifactId.gallery";
import * as artifactCapability from "~/routes/api.artifacts.$artifactId.capability";

const routes = {
  "routes/api.artifact-uploads": { id: "routes/api.artifact-uploads", path: "api/artifact-uploads", module: artifactUploads },
  "routes/api.artifact-uploads.$uploadId.files": { id: "routes/api.artifact-uploads.$uploadId.files", path: "api/artifact-uploads/:uploadId/files", module: artifactUploadFiles },
  "routes/api.artifact-uploads.$uploadId.finalize": { id: "routes/api.artifact-uploads.$uploadId.finalize", path: "api/artifact-uploads/:uploadId/finalize", module: artifactUploadFinalize },
  "routes/api.artifact-uploads.$uploadId.abort": { id: "routes/api.artifact-uploads.$uploadId.abort", path: "api/artifact-uploads/:uploadId/abort", module: artifactUploadAbort },
  "routes/api.artifacts.links": { id: "routes/api.artifacts.links", path: "api/artifacts/links", module: artifactLinks },
  "routes/api.artifacts.$artifactId.link-version": { id: "routes/api.artifacts.$artifactId.link-version", path: "api/artifacts/:artifactId/link-version", module: artifactLinkVersion },
  "routes/api.artifacts.$artifactId": { id: "routes/api.artifacts.$artifactId", path: "api/artifacts/:artifactId", module: artifactResource },
  "routes/api.artifacts.$artifactId.restore-version": { id: "routes/api.artifacts.$artifactId.restore-version", path: "api/artifacts/:artifactId/restore-version", module: artifactRestoreVersion },
  "routes/api.artifacts.$artifactId.gallery": { id: "routes/api.artifacts.$artifactId.gallery", path: "api/artifacts/:artifactId/gallery", module: artifactGallery },
  "routes/api.artifacts.$artifactId.capability": { id: "routes/api.artifacts.$artifactId.capability", path: "api/artifacts/:artifactId/capability", module: artifactCapability },
};

const build = {
  entry: { module: { default: async () => new Response("Not Found", { status: 404 }) } },
  routes,
  assets: { version: "test", entry: {}, routes: {} },
  publicPath: "/",
  assetsBuildDirectory: "/",
  future: {},
  ssr: true,
  isSpaMode: false,
  prerender: [],
  routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
} as ServerBuild;

export default build;
export const {
  entry,
  assets,
  assetsBuildDirectory,
  basename,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  ssr,
} = build;
export { routes };
