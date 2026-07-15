import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ChatMessageBubble } from "../chat-message";
import {
  GardenerProvider,
  useGardener,
  type ContextItem,
} from "../gardener-provider";

function GardenerHarness({
  context,
}: {
  context?: Omit<ContextItem, "id">[];
}) {
  const { askFresh, messages } = useGardener();

  return (
    <>
      <button type="button" onClick={() => askFresh("Help me start.", context)}>
        Start
      </button>
      {messages.map((message) => (
        <ChatMessageBubble key={message.id} message={message} />
      ))}
    </>
  );
}

function renderHarness(context?: Omit<ContextItem, "id">[]) {
  return render(
    <MemoryRouter>
      <GardenerProvider>
        <GardenerHarness context={context} />
      </GardenerProvider>
    </MemoryRouter>,
  );
}

function mockFreshConversation() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(
      new Response("Here is a useful place to start.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function postedChatBody(fetchMock: ReturnType<typeof mockFreshConversation>) {
  const chatCall = fetchMock.mock.calls.find(([url]) => url === "/api/chat");
  expect(chatCall).toBeDefined();
  const options = chatCall?.[1] as RequestInit;
  return JSON.parse(String(options.body)) as {
    context: Omit<ContextItem, "id">[];
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GardenerProvider askFresh", () => {
  it("attaches seeded dataset context to the first sent message", async () => {
    const fetchMock = mockFreshConversation();
    const datasetContext = {
      kind: "dataset" as const,
      label: "Open-Meteo weather",
      content:
        "Formats: JSON, CSV\nDocumentation: https://open-meteo.com/en/docs",
    };
    renderHarness([datasetContext]);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(postedChatBody(fetchMock).context).toEqual([datasetContext]);
    expect(await screen.findByText("Open-Meteo weather")).toBeTruthy();
    expect(screen.getByText(/Formats: JSON, CSV/)).toBeTruthy();
  });

  it("keeps existing one-argument calls free of context", async () => {
    const fetchMock = mockFreshConversation();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(postedChatBody(fetchMock).context).toEqual([]);
    expect(await screen.findByText("Help me start.")).toBeTruthy();
  });
});
