import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
