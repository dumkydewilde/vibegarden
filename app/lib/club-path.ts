export function clubPath(slug: string, path = "") {
  const suffix = path === "" || path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  return `/clubs/${encodeURIComponent(slug)}${suffix}`;
}
