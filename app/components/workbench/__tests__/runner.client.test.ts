import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRunner, RUN_TIMEOUT_MS, type HostHandlers } from "../runner.client";

const RUNNER_URL = "https://usercontent.vibegarden.club/agent-runner";

function runnerFrame(): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe[src="https://usercontent.vibegarden.club/agent-runner"]',
  );
  if (!frame) throw new Error("Expected the runner iframe to exist.");
  return frame;
}

function emitFrom(
  source: Window,
  data: unknown,
  origin = "null",
): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

function hostHandlers(overrides: Partial<HostHandlers> = {}): HostHandlers {
  return {
    fetchPage: vi.fn().mockResolvedValue({ body: "page" }),
    memoryGet: vi.fn().mockResolvedValue(null),
    memorySet: vi.fn().mockResolvedValue(undefined),
    memoryList: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function startRun(host = hostHandlers()) {
  const runner = createRunner({ runnerUrl: RUNNER_URL, host });
  const result = runner.run("return args.value;", { value: 42 });
  const frame = runnerFrame();
  const frameWindow = frame.contentWindow!;
  const postMessage = vi.spyOn(frameWindow, "postMessage");
  emitFrom(frameWindow, { type: "ready" });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  const execute = postMessage.mock.calls[0]?.[0] as {
    type: string;
    id: string;
    source: string;
    args: Record<string, unknown>;
  };
  return { execute, frame, frameWindow, host, postMessage, result, runner };
}

describe("createRunner", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("creates an opaque sandbox frame and resolves an execute lifecycle", async () => {
    const { execute, frame, frameWindow, postMessage, result, runner } =
      await startRun();

    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.hidden).toBe(true);
    expect(execute).toEqual({
      type: "execute",
      id: expect.any(String),
      source: "return args.value;",
      args: { value: 42 },
    });
    expect(postMessage.mock.calls[0]?.[1]).toBe("*");

    emitFrom(frameWindow, {
      type: "result",
      id: execute.id,
      ok: true,
      value: "42",
      logs: ["computed"],
    });

    await expect(result).resolves.toEqual({
      ok: true,
      value: "42",
      logs: ["computed"],
    });
    runner.dispose();
  });

  it("routes every valid host method and posts successful host results", async () => {
    const host = hostHandlers({
      fetchPage: vi.fn().mockResolvedValue({ body: "fetched" }),
      memoryGet: vi.fn().mockResolvedValue("remembered"),
      memorySet: vi.fn().mockResolvedValue({ stored: true }),
      memoryList: vi.fn().mockResolvedValue(["topic"]),
    });
    const { execute, frameWindow, postMessage, result, runner } =
      await startRun(host);

    const calls = [
      ["fetchPage", ["https://example.com"], { body: "fetched" }],
      ["memoryGet", ["topic"], "remembered"],
      ["memorySet", ["topic", "value"], { stored: true }],
      ["memoryList", [], ["topic"]],
    ] as const;

    for (const [index, [method, params, value]] of calls.entries()) {
      emitFrom(frameWindow, {
        type: "host",
        id: execute.id,
        callId: `${execute.id}:${index}`,
        method,
        params,
      });
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith(
          {
            type: "host-result",
            callId: `${execute.id}:${index}`,
            ok: true,
            value,
          },
          "*",
        );
      });
    }

    expect(host.fetchPage).toHaveBeenCalledWith("https://example.com");
    expect(host.memoryGet).toHaveBeenCalledWith("topic");
    expect(host.memorySet).toHaveBeenCalledWith("topic", "value");
    expect(host.memoryList).toHaveBeenCalledWith();

    emitFrom(frameWindow, {
      type: "result",
      id: execute.id,
      ok: true,
      value: "null",
      logs: [],
    });
    await result;
    runner.dispose();
  });

  it("turns host handler failures into bounded host-result errors", async () => {
    const host = hostHandlers({
      fetchPage: vi.fn().mockRejectedValue(new Error("proxy refused access")),
    });
    const { execute, frameWindow, postMessage, result, runner } =
      await startRun(host);

    emitFrom(frameWindow, {
      type: "host",
      id: execute.id,
      callId: `${execute.id}:0`,
      method: "fetchPage",
      params: ["https://example.com"],
    });

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "host-result",
          callId: `${execute.id}:0`,
          ok: false,
          error: "proxy refused access",
        },
        "*",
      );
    });

    emitFrom(frameWindow, {
      type: "result",
      id: execute.id,
      ok: false,
      error: "proxy refused access",
      logs: [],
    });
    await result;
    runner.dispose();
  });

  it("recreates the iframe on timeout and ignores messages from the dead frame", async () => {
    vi.useFakeTimers();
    const first = await startRun();

    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);
    await expect(first.result).resolves.toEqual({
      ok: false,
      error: "Tool timed out after 10 seconds.",
      logs: [],
    });

    const replacement = runnerFrame();
    const replacementWindow = replacement.contentWindow!;
    expect(replacement).not.toBe(first.frame);
    expect(first.frame.isConnected).toBe(false);

    const secondResult = first.runner.run("return 'second';", {});
    const replacementPost = vi.spyOn(replacementWindow, "postMessage");
    emitFrom(first.frameWindow, {
      type: "result",
      id: first.execute.id,
      ok: true,
      value: "\"stale\"",
      logs: [],
    });
    emitFrom(replacementWindow, { type: "ready" });
    await vi.waitFor(() => expect(replacementPost).toHaveBeenCalledTimes(1));
    const secondExecute = replacementPost.mock.calls[0]?.[0] as { id: string };

    emitFrom(first.frameWindow, {
      type: "result",
      id: secondExecute.id,
      ok: true,
      value: "\"wrong source\"",
      logs: [],
    });
    emitFrom(replacementWindow, {
      type: "result",
      id: secondExecute.id,
      ok: true,
      value: "\"second\"",
      logs: [],
    });

    await expect(secondResult).resolves.toEqual({
      ok: true,
      value: "\"second\"",
      logs: [],
    });
    first.runner.dispose();
  });

  it("ignores malformed messages, unexpected origins, and unexpected sources", async () => {
    const host = hostHandlers();
    const runner = createRunner({ runnerUrl: RUNNER_URL, host });
    const result = runner.run("return 1;", {});
    const frame = runnerFrame();
    const frameWindow = frame.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, "postMessage");

    emitFrom(frameWindow, { type: "ready" }, "https://usercontent.vibegarden.club");
    emitFrom(window, { type: "ready" });
    emitFrom(frameWindow, { type: "ready", extra: true });
    expect(postMessage).not.toHaveBeenCalled();

    emitFrom(frameWindow, { type: "ready" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    const execute = postMessage.mock.calls[0]?.[0] as { id: string };

    emitFrom(frameWindow, {
      type: "host",
      id: execute.id,
      callId: `${execute.id}:bad`,
      method: "memorySet",
      params: ["missing-value"],
    });
    emitFrom(frameWindow, {
      type: "result",
      id: execute.id,
      ok: true,
      value: "1",
      logs: [123],
    });
    expect(host.memorySet).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);

    emitFrom(frameWindow, {
      type: "result",
      id: execute.id,
      ok: true,
      value: "1",
      logs: [],
    });
    await expect(result).resolves.toEqual({ ok: true, value: "1", logs: [] });
    runner.dispose();
  });

  it("serializes overlapping run requests", async () => {
    const runner = createRunner({ runnerUrl: RUNNER_URL, host: hostHandlers() });
    const firstResult = runner.run("return 'first';", {});
    const secondResult = runner.run("return 'second';", {});
    const frame = runnerFrame();
    const frameWindow = frame.contentWindow!;
    const postMessage = vi.spyOn(frameWindow, "postMessage");

    emitFrom(frameWindow, { type: "ready" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    const firstExecute = postMessage.mock.calls[0]?.[0] as { id: string };
    emitFrom(frameWindow, {
      type: "result",
      id: firstExecute.id,
      ok: true,
      value: "\"first\"",
      logs: [],
    });
    await firstResult;

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    const secondExecute = postMessage.mock.calls[1]?.[0] as { id: string };
    emitFrom(frameWindow, {
      type: "result",
      id: secondExecute.id,
      ok: true,
      value: "\"second\"",
      logs: [],
    });

    await expect(secondResult).resolves.toMatchObject({ ok: true });
    runner.dispose();
  });
});
