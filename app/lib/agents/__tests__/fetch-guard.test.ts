import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkFetchUrl,
  FETCH_MAX_REDIRECTS,
  FETCH_TIMEOUT_MS,
  isAllowedContentType,
  proxyFetch,
  readCappedText,
} from "../fetch-guard.server";

const blocked = [
  "http://example.com/a",
  "https://127.0.0.1/x",
  "https://[::1]/x",
  "https://192.168.1.10/x",
  "https://localhost/x",
  "https://foo.local/x",
  "https://metadata.internal/x",
  "https://usercontent.vibegarden.club/x",
  "https://vibegarden.club/x",
  "ftp://example.com/x",
  "not a url",
];

const allowed = ["https://example.com/page", "https://api.github.com/repos"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkFetchUrl", () => {
  it.each(blocked)("refuses %s", (raw) => {
    const result = checkFetchUrl(raw);

    expect(result.url).toBeUndefined();
    expect(result.error).toEqual(expect.any(String));
  });

  it.each(allowed)("allows %s", (raw) => {
    const result = checkFetchUrl(raw);

    expect(result.error).toBeUndefined();
    expect(result.url?.toString()).toBe(raw);
  });

  it("explains why private network addresses are refused", () => {
    expect(checkFetchUrl("https://127.0.0.1/")).toEqual({
      error: "That address points at a private network, which the fetch tool does not reach.",
    });
  });
});

describe("isAllowedContentType", () => {
  it.each([
    "text/html; charset=utf-8",
    "application/json",
    "application/xml",
    "application/rss+xml",
  ])("allows %s", (contentType) => {
    expect(isAllowedContentType(contentType)).toBe(true);
  });

  it.each(["image/png", "application/octet-stream", null])(
    "refuses %s",
    (contentType) => {
      expect(isAllowedContentType(contentType)).toBe(false);
    },
  );
});

describe("readCappedText", () => {
  it("caps bytes, reports characters read, and cancels an oversized stream", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"));
        controller.enqueue(encoder.encode("defg"));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readCappedText(new Response(body), 5)).resolves.toEqual({
      body: "abcde",
      totalChars: 7,
      truncated: true,
    });
    expect(cancelled).toBe(true);
  });

  it("uses UTF-8 bytes for the cap and characters for the count", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("éé"));
        controller.enqueue(encoder.encode("z"));
      },
    });

    await expect(readCappedText(new Response(body), 4)).resolves.toEqual({
      body: "éé",
      totalChars: 3,
      truncated: true,
    });
  });
});

describe("proxyFetch", () => {
  it("follows an allowed redirect and shares one timeout across both hops", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://docs.example.com/final" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("finished", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      ) as unknown as typeof fetch;

    await expect(proxyFetch("https://example.com/start", fetchImpl)).resolves.toEqual({
      ok: true,
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "finished",
      totalChars: 8,
      truncated: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.com/start",
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://docs.example.com/final",
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(fetchImpl.mock.calls[1]?.[1]?.signal);
  });

  it("refuses a redirect to a private address before requesting it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/secret" },
      }),
    ) as unknown as typeof fetch;

    await expect(proxyFetch("https://example.com/start", fetchImpl)).resolves.toEqual({
      ok: false,
      error: "That address points at a private network, which the fetch tool does not reach.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured number of redirects", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const current = new URL(String(input));
      const hop = Number(current.searchParams.get("hop") ?? 0);
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/loop?hop=${hop + 1}` },
      });
    }) as unknown as typeof fetch;

    await expect(proxyFetch("https://example.com/loop", fetchImpl)).resolves.toEqual({
      ok: false,
      error: `That page redirected more than ${FETCH_MAX_REDIRECTS} times, so the fetch was stopped.`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(FETCH_MAX_REDIRECTS + 1);
  });

  it("revalidates the redirect destination on the final allowed response", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const current = new URL(String(input));
      const hop = Number(current.searchParams.get("hop") ?? 0);
      return new Response(null, {
        status: 302,
        headers: {
          location:
            hop === FETCH_MAX_REDIRECTS
              ? "https://127.0.0.1/secret"
              : `https://example.com/loop?hop=${hop + 1}`,
        },
      });
    }) as unknown as typeof fetch;

    await expect(proxyFetch("https://example.com/loop", fetchImpl)).resolves.toEqual({
      ok: false,
      error: "That address points at a private network, which the fetch tool does not reach.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(FETCH_MAX_REDIRECTS + 1);
  });

  it("returns a clear timeout error when the shared signal aborts", async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      })) as unknown as typeof fetch;

    const result = proxyFetch("https://example.com/slow", fetchImpl);
    controller.abort(new DOMException("timed out", "TimeoutError"));

    await expect(result).resolves.toEqual({
      ok: false,
      error: `The fetch took longer than ${FETCH_TIMEOUT_MS / 1_000} seconds and was stopped.`,
    });
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
  });

  it("refuses a response whose content type is not text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" },
      }),
    ) as unknown as typeof fetch;

    await expect(proxyFetch("https://example.com/file", fetchImpl)).resolves.toEqual({
      ok: false,
      error: "That page did not return readable text, JSON, or XML.",
    });
  });
});
