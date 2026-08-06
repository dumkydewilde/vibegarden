import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callNote,
  callResultNote,
  capCallResult,
} from "@vibegarden/agent-web";

import { useAgentChat } from "../use-agent-chat";

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
    expect(result.current.rawResults.get(1)).toBe(raw);
    expect(result.current.busy).toBe(false);
  });
});
