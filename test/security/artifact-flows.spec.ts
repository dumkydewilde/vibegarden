import { expect, test } from "@playwright/test";

async function allowDeclaredRemoteCsv(page: import("@playwright/test").Page): Promise<void> {
  await page.route("https://data.example.test/data/remote.csv", (route) => route.fulfill({
    body: "animal,count\nremote,2\n",
    contentType: "text/csv",
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
}

test("a signed preview loads its relative HTML, CSS, JavaScript, image, font, and packaged data", async ({ page }) => {
  await allowDeclaredRemoteCsv(page);
  const seeded = await page.goto("/__fixture/seed?fixture=positive");
  expect(seeded?.ok()).toBeTruthy();
  const fixture = JSON.parse(await page.locator("body").textContent() ?? "{}") as { previewUrl: string };

  await page.setExtraHTTPHeaders({ "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" });
  await page.goto(`/__fixture/wrapper?src=${encodeURIComponent(fixture.previewUrl)}`);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#positive-result")).toHaveText("relative assets and packaged data loaded");
  await expect(frame.locator("img")).toHaveJSProperty("complete", true);
  await expect(frame.locator("#csv-result")).toHaveText("duck,1");
  await expect(frame.locator("#parquet-result")).toHaveText("PAR1");
});

test("declared data origin is available while an undeclared origin is blocked", async ({ page }) => {
  await allowDeclaredRemoteCsv(page);
  await page.goto("/__fixture/seed?fixture=positive");
  const fixture = JSON.parse(await page.locator("body").textContent() ?? "{}") as { previewUrl: string };

  await page.setExtraHTTPHeaders({ "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" });
  await page.goto(`/__fixture/wrapper?src=${encodeURIComponent(fixture.previewUrl)}`);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#remote-result")).toHaveText("remote csv loaded");
  await expect(frame.locator("#undeclared-result")).toHaveText("undeclared blocked");
});
