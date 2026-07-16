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
    route(
      "garden/conversations/:id",
      "routes/garden.conversations.$id.tsx",
    ),
    route("garden/projects/:id", "routes/garden.projects.$id.tsx"),
    route("garden/modules/:slug", "routes/garden.modules.$slug.tsx"),
    route("learning", "routes/learning.tsx"),
    route("learning/:slug", "routes/learning.$slug.tsx"),
    route("artifacts", "routes/artifacts.tsx"),
    route("gallery", "routes/gallery.tsx"),
    route("inspiration", "routes/inspiration.tsx"),
    route("admin", "routes/admin.tsx"),
    route(
      "admin/conversations/:id",
      "routes/admin.conversations.$id.tsx",
    ),
  ]),
  route("join", "routes/join.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/thread", "routes/api.thread.ts"),
  route("api/feedback", "routes/api.feedback.ts"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("auth/google", "routes/auth.google.tsx"),
  route("auth/google/callback", "routes/auth.google.callback.tsx"),
] satisfies RouteConfig;
