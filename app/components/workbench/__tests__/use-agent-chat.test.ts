import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callErrorEnvelope,
  callNote,
  callResultNote,
  capCallResult,
  splitToolNotes,
} from "@vibegarden/agent-web";

import {
  AGENT_MESSAGE_MAX_CHARS,
  parseAgentChatRequest,
} from "~/lib/agents/chat-request";
import { rawResultKey, useAgentChat } from "../use-agent-chat";

const encoder = new TextEncoder();

describe("useAgentChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends the user message and streams the assistant response", async () => {
    let finishStream!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("Hello"));
        finishStream = () => {
          controller.enqueue(encoder.encode(" there"));
          controller.close();
        };
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
      }),
    );

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("Hi there");
    });

    await waitFor(() => {
      expect(result.current.busy).toBe(true);
      expect(result.current.entries).toEqual([
        { role: "user", content: "Hi there" },
        { role: "assistant", content: "Hello" },
      ]);
    });

    act(() => finishStream());
    await act(async () => sending);

    expect(result.current.entries).toEqual([
      { role: "user", content: "Hi there" },
      { role: "assistant", content: "Hello there" },
    ]);
    expect(result.current.busy).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/clubs/garden-club/api/agents/agent-1/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a reachable error when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
      }),
    );

    await act(async () => result.current.send("Are you there?"));

    expect(result.current.entries).toEqual([
      { role: "user", content: "Are you there?" },
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("not reachable"),
      }),
    ]);
    expect(result.current.busy).toBe(false);
  });

  it("executes a terminal tool call and streams its continuation into the same trace", async () => {
    const raw = "<html>the complete page body</html>";
    const envelope = capCallResult(raw);
    const marker = callNote({
      tool: "fetch_page",
      args: { url: "https://example.com/guide" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(marker));
              controller.close();
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode("The guide says to start with a small test."),
              );
              controller.close();
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const executor = vi.fn().mockResolvedValue({ raw, envelope });
    const fallbackExecutor = vi.fn();
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
        executors: { fetch_page: executor },
        fallbackExecutor,
      }),
    );

    await act(async () => result.current.send("Read the guide"));

    expect(executor).toHaveBeenCalledWith({
      tool: "fetch_page",
      args: { url: "https://example.com/guide" },
    });
    expect(fallbackExecutor).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const continuation = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    );
    expect(continuation).toEqual({
      versionId: "version-1",
      continuation: true,
      messages: [
        { role: "user", content: "Read the guide" },
        {
          role: "assistant",
          content: `${marker}\n\n${callResultNote(envelope)}`,
        },
        {
          role: "data",
          content: JSON.stringify({ tool: "fetch_page", envelope }),
        },
      ],
    });
    expect(result.current.entries).toEqual([
      { role: "user", content: "Read the guide" },
      {
        role: "assistant",
        content: `${marker}\n\n${callResultNote(envelope)}\n\nThe guide says to start with a small test.`,
      },
    ]);
    expect(result.current.rawResults.get(rawResultKey(1, 0))).toBe(raw);
    expect(result.current.busy).toBe(false);
  });

  it("keeps failed runner logs in raw trace state and out of model transport", async () => {
    const marker = callNote({
      tool: "extract_title",
      args: { title: "Workbench" },
    });
    const envelope = callErrorEnvelope("extraction failed");
    const raw = "Runner error:\nextraction failed\n\nRunner logs:\nstarted extraction";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(marker))
      .mockResolvedValueOnce(new Response("I could not extract the title."));
    vi.stubGlobal("fetch", fetchMock);
    const fallbackExecutor = vi.fn().mockResolvedValue({ raw, envelope });
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
        fallbackExecutor,
      }),
    );

    await act(async () => result.current.send("Extract the title"));

    const continuation = String(
      (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body,
    );
    expect(continuation).toContain("extraction failed");
    expect(continuation).not.toContain("started extraction");
    expect(result.current.rawResults.get(rawResultKey(1, 0))).toBe(raw);
    expect(result.current.entries[1]?.content).toContain(
      "I could not extract the title.",
    );
  });

  it("continues a multi-call trace after accumulated narration exceeds the message cap", async () => {
    const firstCall = callNote({
      tool: "fetch_page",
      args: { url: "https://example.com/first" },
    });
    const secondCall = callNote({
      tool: "fetch_page",
      args: { url: "https://example.com/second" },
    });
    const longNarration = "n".repeat(AGENT_MESSAGE_MAX_CHARS + 500);
    const responses = [firstCall, `${longNarration}\n\n${secondCall}`, "Done."];
    const fetchMock = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const parsed = parseAgentChatRequest(request);
      if ("error" in parsed) {
        return Promise.resolve(new Response(null, { status: 400 }));
      }
      const text = responses.shift();
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(text));
              controller.close();
            },
          }),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const executor = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "first raw",
        envelope: capCallResult("first result"),
      })
      .mockResolvedValueOnce({
        raw: "second raw",
        envelope: capCallResult("second result"),
      });
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
        executors: { fetch_page: executor },
      }),
    );

    await act(async () => result.current.send("Read both pages"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.current.entries[1]?.content).toContain(longNarration);
    expect(result.current.entries[1]?.content).toContain("Done.");
    expect(result.current.entries[1]?.content).not.toContain("not reachable");
    expect(result.current.rawResults).toEqual(
      new Map([
        [rawResultKey(1, 0), "first raw"],
        [rawResultKey(1, 1), "second raw"],
      ]),
    );

    const finalContinuation = JSON.parse(
      String(
        (fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body,
      ),
    );
    const assistantTransport = finalContinuation.messages.at(-2)?.content;
    expect(assistantTransport).toContain(firstCall);
    expect(assistantTransport).toContain(secondCall);
    expect(assistantTransport.length).toBeLessThan(
      result.current.entries[1]!.content.length,
    );
    expect(parseAgentChatRequest(finalContinuation)).toHaveProperty("value");
  });

  it("closes the call without running a tool when a maximum Unicode result cannot fit", async () => {
    const largeCall = callNote({
      tool: "fetch_page",
      args: { url: `https://example.com/${"x".repeat(16_800)}` },
    });
    expect(largeCall).toHaveLength(16_937);
    const maximumEmojiEnvelope = capCallResult("😀".repeat(2_000));
    expect(maximumEmojiEnvelope.resultText).toHaveLength(4_000);
    expect(
      parseAgentChatRequest({
        versionId: "version-1",
        continuation: true,
        messages: [
          { role: "user", content: "Try the large call" },
          {
            role: "assistant",
            content: `${largeCall}\n\n${callResultNote(maximumEmojiEnvelope)}`,
          },
          {
            role: "data",
            content: JSON.stringify({
              tool: "fetch_page",
              envelope: maximumEmojiEnvelope,
            }),
          },
        ],
      }),
    ).toHaveProperty("error");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(largeCall));
            controller.close();
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const executor = vi.fn().mockResolvedValue({
      raw: "😀".repeat(2_000),
      envelope: maximumEmojiEnvelope,
    });
    const { result } = renderHook(() =>
      useAgentChat({
        clubSlug: "garden-club",
        agentId: "agent-1",
        versionId: "version-1",
        executors: { fetch_page: executor },
      }),
    );

    await act(async () => result.current.send("Try the oversized call"));

    expect(executor).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const assistantContent = result.current.entries[1]?.content ?? "";
    const safeStop =
      "The tool was not run because its result could not be continued safely.";
    expect(assistantContent).toBe(
      `${largeCall}\n\n${callResultNote(callErrorEnvelope(safeStop))}\n\n${safeStop}`,
    );
    expect(
      splitToolNotes(assistantContent).map((segment) => segment.type),
    ).toEqual(["call", "callresult", "text"]);
    expect(
      parseAgentChatRequest({
        versionId: "version-1",
        messages: [
          { role: "user", content: "Try the large call" },
          { role: "assistant", content: assistantContent },
          { role: "user", content: "Continue" },
        ],
      }),
    ).toHaveProperty("value");
    expect(result.current.rawResults).toEqual(new Map());
  });
});
