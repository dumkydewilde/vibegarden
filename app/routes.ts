import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("garden", "routes/garden.tsx"),
    route("learning", "routes/learning.tsx"),
    route("learning/:slug", "routes/learning.$slug.tsx"),
    route("artifacts", "routes/artifacts.tsx"),
    route("gallery", "routes/gallery.tsx"),
    route("inspiration", "routes/inspiration.tsx"),
    route("admin", "routes/admin.tsx"),
  ]),
  route("join", "routes/join.tsx"),
] satisfies RouteConfig;
