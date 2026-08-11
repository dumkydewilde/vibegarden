import { expect, test, type Page } from "@playwright/test";

const runnerUrl = "http://usercontent.vibegarden.test:8788/agent-runner";

type RunnerResult = {
  type: "result";
  id: string;
  ok: boolean;
  value?: string;
  error?: string;
  logs: string[];
};

async function openRunner(page: Page): Promise<void> {
  await page.goto(`/__fixture/wrapper?src=${encodeURIComponent(runnerUrl)}`);
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.frameLocator("iframe").locator("body")).toBeAttached();
}

async function execute(page: Page, source: string, args: Record<string, unknown> = {}): Promise<RunnerResult> {
  return page.evaluate(
    ({ source: executionSource, args: executionArgs }) => new Promise<RunnerResult>((resolve, reject) => {
      const frame = document.querySelector("iframe");
      if (!frame?.contentWindow) {
        reject(new Error("Runner iframe is unavailable."));
        return;
      }
      const id = `runner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Runner response timed out."));
      }, 5_000);
      function onMessage(event: MessageEvent) {
        const message = event.data as Partial<RunnerResult> | null;
        if (event.source !== frame.contentWindow || message?.type !== "result" || message.id !== id) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(message as RunnerResult);
      }
      window.addEventListener("message", onMessage);
      frame.contentWindow.postMessage({ type: "execute", id, source: executionSource, args: executionArgs }, "*");
    }),
    { source, args },
  );
}

test("serves the runner with an explicit frame and network-denying policy", async ({ page }) => {
  const direct = await page.goto(runnerUrl);
  expect(direct?.status()).toBe(200);
  const headers = direct?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'");
  expect(headers["content-security-policy"]).toContain("worker-src blob:");
  expect(headers["content-security-policy"]).toContain("frame-ancestors http://vibegarden.test:8788");
  expect(headers["content-security-policy"]).not.toContain("*");
  expect(headers["x-frame-options"]).toBeUndefined();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["permissions-policy"]).toContain("camera=()");

  await openRunner(page);

  const fetchResult = await execute(page, 'return await fetch("https://example.com").then((response) => response.status);');
  expect(fetchResult.ok).toBe(false);
  expect(fetchResult.error).toBeTruthy();

  const parentResult = await execute(page, "return window.parent.document.title;");
  expect(parentResult.ok).toBe(false);
  expect(parentResult.error).toBeTruthy();

  await expect(execute(page, "return document.cookie;")).resolves.toMatchObject({ ok: true, value: "\"\"", logs: [] });
  await expect(execute(page, "env.log('hi'); return args.a + args.b;", { a: 2, b: 3 })).resolves.toMatchObject({
    ok: true,
    value: "5",
    logs: ["hi"],
  });

  const cappedLogs = await execute(page, "for (let i = 0; i < 55; i += 1) env.log('x'.repeat(600));");
  expect(cappedLogs).toMatchObject({ ok: true, value: "null" });
  expect(cappedLogs.logs).toHaveLength(50);
  expect(cappedLogs.logs.every((line) => line.length === 500)).toBe(true);

  await expect(execute(page, "const value = {}; value.self = value; return value;")).resolves.toMatchObject({ ok: false });
});

test("runs tool source without navigation or script-import network channels", async ({ page }) => {
  await openRunner(page);
  const leakedUrl = "http://vibegarden.test:8788/__fixture/form?leak=runner-secret";
  const attemptedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("runner-secret")) attemptedRequests.push(request.url());
  });

  const result = await execute(page, `location.href = ${JSON.stringify(leakedUrl)}; return location.href;`);
  const importResult = await execute(page, `importScripts(${JSON.stringify(`${leakedUrl}&kind=script`)}); return "imported";`);
  const forgedBridge = await execute(page, 'postMessage({ type: "host", method: "memoryList", params: [] });');

  expect(result.ok).toBe(false);
  expect(importResult).toMatchObject({ ok: false });
  expect(forgedBridge).toMatchObject({ ok: false });
  expect(forgedBridge.error).toContain("declared env capabilities");
  expect(attemptedRequests).toEqual([]);
  expect(page.frames().some((frame) => frame.url().includes("runner-secret"))).toBe(false);
  expect(page.frames().some((frame) => frame.url() === runnerUrl)).toBe(true);
});

test("keeps runner control state outside the user execution realm", async ({ page }) => {
  await openRunner(page);

  await expect(execute(page, "return [typeof busy, typeof pending, typeof hostCall].join(',');")).resolves.toMatchObject({
    ok: true,
    value: '"undefined,undefined,undefined"',
  });
});

test("bridges host calls and rejects concurrent execution", async ({ page }) => {
  await openRunner(page);

  const messages = await page.evaluate(() => new Promise<{ host: unknown; first: RunnerResult; second: RunnerResult }>((resolve, reject) => {
    const frame = document.querySelector("iframe");
    if (!frame?.contentWindow) {
      reject(new Error("Runner iframe is unavailable."));
      return;
    }
    const firstId = "host-call";
    const secondId = "busy-call";
    let host: Record<string, unknown> | null = null;
    let first: RunnerResult | null = null;
    let second: RunnerResult | null = null;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Runner host bridge timed out."));
    }, 5_000);
    function finish() {
      if (!host || !first || !second) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({ host, first, second });
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type === "host" && message.id === firstId && typeof message.callId === "string") {
        host = message;
        frame.contentWindow?.postMessage({ type: "execute", id: secondId, source: "return 'second';", args: {} }, "*");
        return;
      }
      if (message.type !== "result") return;
      if (message.id === secondId) {
        second = message as RunnerResult;
        frame.contentWindow?.postMessage({ type: "host-result", callId: host?.callId, ok: true, value: "released" }, "*");
      } else if (message.id === firstId) {
        first = message as RunnerResult;
      }
      finish();
    }
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({
      type: "execute",
      id: firstId,
      source: 'globalThis.busy = false; globalThis.pending = new Map(); globalThis.hostCall = () => "forged"; return await env.fetchPage("https://example.com/article");',
      args: {},
    }, "*");
  }));

  expect(messages.host).toMatchObject({
    type: "host",
    id: "host-call",
    method: "fetchPage",
    params: ["https://example.com/article"],
  });
  expect(messages.second).toMatchObject({ ok: false, error: "Runner is busy with another call.", logs: [] });
  expect(messages.first).toMatchObject({ ok: true, value: "\"released\"", logs: [] });
});

test("refuses framing by origins outside the configured website", async ({ page }) => {
  await page.goto("about:blank");
  await page.setContent(`<iframe sandbox="allow-scripts" src="${runnerUrl}"></iframe>`);

  await expect.poll(() => page.frames().some((frame) => frame.url() === runnerUrl)).toBe(false);
});
