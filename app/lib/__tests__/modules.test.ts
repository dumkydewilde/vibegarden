import { describe, expect, it } from "vitest";
import {
  getModule,
  getModuleRaw,
  getModules,
  getModulesByCategory,
  isModuleName,
  modules,
} from "~/lib/modules";

describe("module collection", () => {
  it("finds the building blocks with complete metadata", () => {
    const all = getModules();
    expect(all.length).toBeGreaterThanOrEqual(14);
    for (const meta of all) {
      expect(meta.slug).toBeTruthy();
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.category).not.toBe("Other");
    }
  });

  it("groups by category without duplicates, inputs first", () => {
    const groups = getModulesByCategory();
    const names = groups.map((g) => g.category);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("Getting things in");
    expect(groups.flatMap((g) => g.modules).length).toBe(getModules().length);
  });

  it("sorts by order within a category", () => {
    for (const group of getModulesByCategory()) {
      const orders = group.modules.map((m) => m.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  it("exposes raw text for the Gardener's read_module tool and context", () => {
    for (const meta of getModules()) {
      const raw = getModuleRaw(meta.slug);
      expect(raw).toContain("title:");
      expect(raw!.length).toBeGreaterThan(500);
    }
  });

  it("keeps titles and slug lookups in sync", () => {
    expect(isModuleName("Database")).toBe(true);
    expect(getModule("scheduled-task")?.meta.category).toBe(
      "Showing and running",
    );
    expect(modules.length).toBe(getModules().length);
  });
});
