import { expect, test } from "@playwright/test";

async function seed(page: import("@playwright/test").Page, fixture: "forbidden" | "positive") {
  const response = await page.goto(`/__fixture/seed?fixture=${fixture}`);
  expect(response?.ok()).toBeTruthy();
  return page.locator("body").textContent().then((body) => JSON.parse(body ?? "{}") as { previewUrl: string; expiredUrl: string; tamperedUrl: string });
}

test("uploaded content remains in an opaque, capability-only iframe", async ({ page }) => {
  const fixture = await seed(page, "forbidden");
  await page.setExtraHTTPHeaders({ "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" });
  await page.goto(`/__fixture/wrapper?src=${encodeURIComponent(fixture.previewUrl)}`);

  await expect.poll(() => page.evaluate(() => window.artifactAttempts)).toMatchObject({
    parentDom: "blocked",
    parentWrite: "blocked",
    cookies: "blocked",
    storage: "blocked",
    indexedDb: "blocked",
    popup: "blocked",
    topNavigation: "blocked",
    websiteWrite: "blocked",
    undeclaredFetch: "blocked",
    nestedFrame: "blocked",
    capabilities: {
      camera: "blocked", microphone: "blocked", geolocation: "blocked",
      clipboard: "blocked", payment: "blocked", usb: "blocked",
    },
  });

  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).toContainText("security probe complete");
  await expect(page.locator("#parent-marker")).toHaveText("parent intact");
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
});

test("direct, expired, and tampered renderer capabilities fail safely", async ({ page }) => {
  const fixture = await seed(page, "positive");

  for (const url of [fixture.previewUrl, fixture.expiredUrl, fixture.tamperedUrl]) {
    const response = await page.goto(url);
    expect([403, 404]).toContain(response?.status());
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.locator("body")).not.toContainText(/artifact|capability|secret/i);
  }
});
