import type { ComponentType } from "react";

/**
 * The building blocks participants can combine into projects, driven by
 * `content/modules/*.mdx`. Drop a file in, it becomes a block. Used by the
 * Idea Garden, project forms, the module drill-down pages, and the
 * Gardener's prompt and read_module tool.
 */
export type ModuleMeta = {
  slug: string;
  title: string;
  description: string;
  category: string;
  order: number;
};

export type Module = {
  meta: ModuleMeta;
  Component: ComponentType<{
    components?: Record<string, ComponentType<unknown>>;
  }>;
};

type MdxModule = {
  default: Module["Component"];
  frontmatter?: Record<string, unknown>;
};

// Eager, like content/learning: the set is small and ships as one bundle.
const mdxModules = import.meta.glob<MdxModule>("/content/modules/*.mdx", {
  eager: true,
});
const rawModules = import.meta.glob<string>("/content/modules/*.mdx", {
  eager: true,
  query: "?raw",
  import: "default",
});

const slugOf = (path: string) => path.split("/").pop()!.replace(/\.mdx$/, "");

const moduleMap = new Map<string, Module>(
  Object.entries(mdxModules).map(([path, mod]) => {
    const slug = slugOf(path);
    const fm = mod.frontmatter ?? {};
    const meta: ModuleMeta = {
      slug,
      title: String(fm.title ?? slug),
      description: String(fm.description ?? ""),
      category: String(fm.category ?? "Other"),
      order: Number(fm.order ?? 999),
    };
    return [slug, { meta, Component: mod.default }];
  }),
);

export function getModules(): ModuleMeta[] {
  return [...moduleMap.values()]
    .map((m) => m.meta)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Groups in order of first appearance, i.e. driven by frontmatter order. */
export function getModulesByCategory(): {
  category: string;
  modules: ModuleMeta[];
}[] {
  const groups: { category: string; modules: ModuleMeta[] }[] = [];
  for (const meta of getModules()) {
    const group = groups.find((g) => g.category === meta.category);
    if (group) group.modules.push(meta);
    else groups.push({ category: meta.category, modules: [meta] });
  }
  return groups;
}

export function getModule(slug: string): Module | undefined {
  return moduleMap.get(slug);
}

export function getModuleRaw(slug: string): string | undefined {
  const entry = Object.entries(rawModules).find(([p]) => slugOf(p) === slug);
  return entry?.[1];
}

/** Display names, in curated order. Stored on projects as-is. */
export const modules: string[] = getModules().map((m) => m.title);

export function isModuleName(value: string): boolean {
  return modules.includes(value);
}
