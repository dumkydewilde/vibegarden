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
  await expect(frame.locator("#parquet-result")).toHaveText("duck,1");
  await expect(frame.locator("#duckdb-result")).toHaveText("duckdb read csv and parquet");
  await expect(frame.locator("#font-result")).toHaveText("font loaded");
  await expect(frame.locator("#font-result")).toHaveAttribute("data-loaded", "true");
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

test("browser product flow keeps artifact state transitions and renderer wrappers observable", async ({ page }) => {
  const call = async (action: string, input: Record<string, unknown> = {}) => page.evaluate(async ({ action, input }) => {
    const response = await fetch("/__fixture/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...input }),
    });
    return { status: response.status, body: await response.json() };
  }, { action, input });

  await page.goto("/__fixture/flow-page");
  const reset = await call("reset");
  expect(reset.status).toBe(200);

  const created = await call("create", { source: "single_html", projectId: "existing-project", title: "Original title" });
  expect(created.body.artifact).toMatchObject({ type: "html", visibility: "private", projectId: "existing-project", currentVersion: { number: 1 } });
  const artifactId = created.body.artifact.id as string;

  // This must be a repository lookup, not fixture-owned state: a second user
  // cannot observe an owner's private artifact even when it knows the ID.
  const foreignRead = await call("get", { artifactId, actor: "user-b" });
  expect(foreignRead.status).toBe(404);

  await expect.poll(async () => (await call("metadata", { artifactId, title: "Renamed" })).body.artifact.title).toBe("Renamed");
  const next = await call("version", { artifactId, source: "zip" });
  expect(next.body.artifact).toMatchObject({ currentVersion: { number: 2 }, title: "Renamed" });
  const retainedVersionId = next.body.artifact.currentVersion.id as string;
  const restored = await call("restore", { artifactId, versionId: created.body.artifact.version.id });
  expect(restored.body.artifact).toMatchObject({ currentVersion: { number: 1 } });
  expect((await call("versions", { artifactId })).body.versions.map((version: { id: string }) => version.id)).toContain(retainedVersionId);

  const shared = await call("gallery", { artifactId });
  expect(shared.body.artifact).toMatchObject({ visibility: "gallery", galleryVersion: { id: created.body.artifact.version.id } });
  await call("version", { artifactId, source: "new-upload" });
  const galleryAfterUpload = await call("get", { artifactId });
  expect(galleryAfterUpload.body.artifact.galleryVersion.id).toBe(created.body.artifact.version.id);
  expect((await call("unshare", { artifactId })).body.artifact).toMatchObject({ visibility: "private", galleryVersion: null });

  const wrappers = await call("wrappers", { artifactId });
  expect(wrappers.status).toBe(200);
  for (const url of [wrappers.body.detailUrl, wrappers.body.fullscreenUrl]) {
    await page.goto(url);
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
    await expect(page.locator("[data-wrapper-state]")).toHaveAttribute("data-wrapper-state", "preserved");
  }

  const refreshed = await call("refresh-capability", { artifactId });
  expect(refreshed.body).toMatchObject({ state: "preserved", url: expect.any(String) });

  const deleted = await call("delete", { artifactId });
  expect(deleted.body.artifact).toBeNull();
  expect((await call("recover", { artifactId })).body.artifact.deletedAt).toBeNull();

  const safeFile = await call("create", { source: "safe_file", projectId: "seed-project" });
  const link = await call("create", { source: "https_link", projectId: "seed-project" });
  const inline = await call("create", { source: "inline_seed", projectId: "seed-project" });
  expect([safeFile.body.artifact.type, link.body.artifact.type, inline.body.artifact.type]).toEqual(["file", "link", "html"]);
  const download = await call("download", { artifactId: safeFile.body.artifact.id });
  const attachment = page.waitForEvent("download");
  await page.goto(download.body.url).catch((error) => {
    if (!(error instanceof Error) || !error.message.includes("Download is starting")) throw error;
  });
  expect((await attachment).suggestedFilename()).toBe("download.txt");
});
