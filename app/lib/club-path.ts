export function clubPath(slug: string, path = "") {
  const suffix = path === "" || path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  return `/clubs/${encodeURIComponent(slug)}${suffix}`;
}

const LEGACY_CLUB_SECTIONS = new Set([
  "garden",
  "learning",
  "artifacts",
  "gallery",
  "inspiration",
  "admin",
]);

/** Returns the WOTF replacement for a supported legacy workspace URL. */
export function legacyClubPath(url: string, section: string, rest = "") {
  if (!LEGACY_CLUB_SECTIONS.has(section)) return null;
  const original = new URL(url);
  const path = [section, rest].filter(Boolean).join("/");
  return `${clubPath("wotf", path)}${original.search}${original.hash}`;
}
