import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDatasetContext,
  datasets,
} from "~/lib/inspiration-datasets";
import Inspiration from "../inspiration";

const gardener = vi.hoisted(() => ({
  askFresh: vi.fn(),
}));

vi.mock("~/components/gardener/gardener-provider", () => ({
  useOptionalGardener: () => ({
    askFresh: gardener.askFresh,
    busy: false,
  }),
}));

beforeEach(() => {
  gardener.askFresh.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Inspiration datasets", () => {
  it("renders twelve beginner cards with formats and two explicit actions", () => {
    render(<Inspiration />);

    const heading = screen.getByRole("heading", {
      name: "Datasets to start from",
    });
    const section = heading.closest("section");
    expect(section).not.toBeNull();

    const cards = within(section!).getAllByTestId("dataset-card");
    expect(cards).toHaveLength(12);
    expect(within(section!).getByText("Open-Meteo weather")).toBeTruthy();
    expect(within(section!).queryByText("KNMI weather data")).toBeNull();
    expect(
      within(section!).getAllByRole("button", { name: /Ask Gardener about/ }),
    ).toHaveLength(12);

    const docsLinks = within(section!).getAllByRole("link", {
      name: /Read the docs for/,
    });
    expect(docsLinks).toHaveLength(12);
    for (const link of docsLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }

    const weatherCard = within(section!)
      .getByText("Open-Meteo weather")
      .closest('[data-testid="dataset-card"]');
    expect(weatherCard).not.toBeNull();
    expect(within(weatherCard!).getByText("JSON")).toBeTruthy();
    expect(within(weatherCard!).getByText("CSV")).toBeTruthy();
    expect(within(weatherCard!).getByText("XLSX")).toBeTruthy();
    expect(within(weatherCard!).getByText("No API key")).toBeTruthy();
    expect(
      within(weatherCard!)
        .getByRole("link", { name: "Read the docs for Open-Meteo weather" })
        .getAttribute("href"),
    ).toBe("https://open-meteo.com/en/docs");
  });

  it("starts a fresh Gardener conversation with visible dataset context", () => {
    render(<Inspiration />);
    const weather = datasets.find(
      ({ title }) => title === "Open-Meteo weather",
    );
    expect(weather).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Gardener about Open-Meteo weather",
      }),
    );

    expect(gardener.askFresh).toHaveBeenCalledWith(weather!.starterPrompt, [
      {
        kind: "dataset",
        label: weather!.title,
        content: buildDatasetContext(weather!),
      },
    ]);
  });
});
