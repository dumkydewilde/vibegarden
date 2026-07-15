import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Inspiration from "../inspiration";

const expectedDatasets = new Map([
  [
    "KNMI weather data",
    "https://dataplatform.knmi.nl/en/dataset/daily-in-situ-meteorological-observations-validated-1-0",
  ],
  ["Amsterdam open geodata", "https://maps.amsterdam.nl/open_geodata/"],
  ["Open Food Facts", "https://world.openfoodfacts.org/data"],
  ["Your Goodreads export", "https://www.goodreads.com/review/import"],
  ["TalkData", "https://talk-data.com/"],
  [
    "CBS StatLine",
    "https://www.cbs.nl/en-gb/our-services/open-data/statline-as-open-data",
  ],
  [
    "Your Spotify history",
    "https://support.spotify.com/us/article/data-rights-and-privacy-settings/",
  ],
  [
    "Your Strava archive",
    "https://support.strava.com/en-us/articles/15401919-exporting-your-data-and-bulk-export",
  ],
  ["Stack Overflow Developer Survey", "https://survey.stackoverflow.co/"],
  ["iNaturalist observations", "https://www.inaturalist.org/pages/developers"],
  ["Dutch election results", "https://www.verkiezingsuitslagen.nl/"],
  ["Luchtmeetnet air quality", "https://api-docs.luchtmeetnet.nl/"],
]);

describe("Inspiration datasets", () => {
  it("offers twelve linked datasets with their verified destinations", () => {
    render(<Inspiration />);

    const heading = screen.getByRole("heading", {
      name: "Datasets to start from",
    });
    const section = heading.closest("section");

    expect(section).not.toBeNull();
    const links = within(section!).getAllByRole("link");
    expect(links).toHaveLength(expectedDatasets.size);

    for (const [title, href] of expectedDatasets) {
      const link = within(section!).getByText(title).closest("a");
      expect(link?.getAttribute("href")).toBe(href);
    }
  });
});
