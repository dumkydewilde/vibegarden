import { describe, expect, it } from "vitest";
import { buildDatasetContext, datasets } from "../inspiration-datasets";

describe("inspiration datasets", () => {
  it("provides twelve beginner-friendly sources with usable metadata", () => {
    const titles = datasets.map(({ title }) => title);

    expect(datasets).toHaveLength(12);
    expect(titles).toContain("Open-Meteo weather");
    expect(titles).toContain("MovieLens Latest Small");
    expect(titles).not.toContain("KNMI weather data");
    expect(titles).not.toContain("TalkData");
    expect(datasets.every((item) => item.formats.length > 0)).toBe(true);
    expect(datasets.every((item) => item.availableData.length > 0)).toBe(true);
    expect(datasets.every((item) => item.docsUrl.startsWith("https://"))).toBe(
      true,
    );
    // Every card carries a pre-researched briefing so the Gardener need
    // not fetch the docs page to understand the source.
    expect(datasets.every((item) => item.briefing.length > 100)).toBe(true);
  });

  it("hands the Gardener the briefing and offers in-browser analysis", () => {
    const weather = datasets.find(
      ({ title }) => title === "Open-Meteo weather",
    );
    const context = buildDatasetContext(weather!);

    expect(context).toContain("Briefing (pre-researched background):");
    expect(context).toContain("WMO code");
    // Lead it away from re-fetching and toward analyzing attached data.
    expect(context).toContain("Rely on the briefing above");
    expect(context).toContain("analyze this data right here");
    expect(context).toContain("query it with SQL");
  });

  it("serializes public source metadata without pretending it was analyzed", () => {
    const weather = datasets.find(
      ({ title }) => title === "Open-Meteo weather",
    );

    expect(weather).toBeDefined();
    const context = buildDatasetContext(weather!);
    expect(context).toContain("https://open-meteo.com/en/docs");
    expect(context).toContain("Formats: JSON, CSV, XLSX");
    expect(context).toContain("Access: No API key");
    expect(context).toContain("format=csv");
    expect(context).toContain("forecast_days=2");
    expect(context).toContain(
      "not proof that any URL or file has been fetched or analyzed",
    );
  });

  it("tells the Gardener to request personal exports from the participant", () => {
    const goodreads = datasets.find(
      ({ title }) => title === "Your Goodreads export",
    );

    expect(goodreads).toBeDefined();
    const context = buildDatasetContext(goodreads!);
    expect(context).toContain("Access: Account export");
    expect(context).toContain("No participant data is included here");
    expect(context).toContain("ask them to supply the file");
    expect(context).not.toContain("My Rating:");
  });
});
