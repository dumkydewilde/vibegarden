import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ChatMessageBubble } from "../chat-message";
import {
  GardenerProvider,
  useGardener,
  type ContextItem,
} from "../gardener-provider";

const OPEN_KEY = "vg-gardener-open";

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

function Probe() {
  const { open, setOpen, webSearch } = useGardener();
  return (
    <>
      <span>{open ? "open" : "closed"}</span>
      <span>{webSearch ? "web search on" : "web search off"}</span>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
    </>
  );
}

function AgentContextProbe() {
  const { addContext, ask, contextItems, removeAgentContext } = useGardener();
  const attach = (agentId: string, label: string) =>
    addContext({
      kind: "agent-definition",
      agentId,
      label,
      content: JSON.stringify({ version: 1, systemPrompt: label }),
    });
  return (
    <>
      <button type="button" onClick={() => attach("agent-a", "Agent A")}>
        Attach A
      </button>
      <button type="button" onClick={() => attach("agent-b", "Agent B")}>
        Attach B
      </button>
      <button type="button" onClick={() => ask("Build a tool.")}>
        Ask
      </button>
      <button type="button" onClick={() => removeAgentContext("agent-a")}>
        Leave A
      </button>
      <output data-testid="agent-contexts">
        {contextItems
          .filter((item) => item.kind === "agent-definition")
          .map((item) => `${item.agentId}:${item.label}`)
          .join(",")}
      </output>
    </>
  );
}

function renderHarness(
  context?: Omit<ContextItem, "id">[],
  apiBase?: string,
) {
  return render(
    <MemoryRouter initialEntries={["/clubs/wotf"]}>
      <Routes>
        <Route
          path="/clubs/:clubSlug/*"
          element={
            <GardenerProvider apiBase={apiBase}>
              <GardenerHarness context={context} />
            </GardenerProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={["/clubs/wotf"]}>
      <Routes>
        <Route
          path="/clubs/:clubSlug/*"
          element={
            <GardenerProvider>
              <Probe />
            </GardenerProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderAgentContextProbe() {
  return render(
    <MemoryRouter initialEntries={["/clubs/wotf/garden/agents/agent-a"]}>
      <Routes>
        <Route
          path="/clubs/:clubSlug/*"
          element={
            <GardenerProvider>
              <AgentContextProbe />
            </GardenerProvider>
          }
        />
      </Routes>
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
  const chatCall = fetchMock.mock.calls.find(
    ([url]) => url === "/clubs/wotf/api/chat",
  );
  expect(chatCall).toBeDefined();
  const options = chatCall?.[1] as RequestInit;
  return JSON.parse(String(options.body)) as {
    context: Omit<ContextItem, "id">[];
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
}

let storage = createStorage();

beforeEach(() => {
  storage = createStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GardenerProvider askFresh", () => {
  it("uses the supplied canonical API base", async () => {
    const fetchMock = mockFreshConversation();
    renderHarness(undefined, "/clubs/canonical/api");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/clubs/canonical/api/thread",
      "/clubs/canonical/api/chat",
    ]);
  });

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

  it("shows a human-safe fallback when the API error is structured data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ error: { provider: "private diagnostic" } }, { status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText("The Gardener could not answer just now.")).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });
});

describe("GardenerProvider agent context identity", () => {
  it("removes only the context owned by a departed agent route", () => {
    renderAgentContextProbe();

    fireEvent.click(screen.getByRole("button", { name: "Attach A" }));
    expect(screen.getByTestId("agent-contexts")).toHaveTextContent("agent-a");
    fireEvent.click(screen.getByRole("button", { name: "Leave A" }));
    expect(screen.getByTestId("agent-contexts")).toBeEmptyDOMElement();
  });

  it("replaces a prior agent definition and sends the current agent id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("I can help with that.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderAgentContextProbe();

    fireEvent.click(screen.getByRole("button", { name: "Attach A" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach B" }));

    expect(screen.getByTestId("agent-contexts")).toHaveTextContent(
      "agent-b:Agent B",
    );
    expect(screen.getByTestId("agent-contexts")).not.toHaveTextContent(
      "agent-a",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(options.body)) as {
      context: Array<{ agentId?: string; label: string }>;
    };
    expect(body.context).toEqual([
      expect.objectContaining({ agentId: "agent-b", label: "Agent B" }),
    ]);
    expect(screen.getByTestId("agent-contexts")).toBeEmptyDOMElement();
  });
});

describe("GardenerProvider panel preference", () => {
  it("keeps web search off for a new conversation", () => {
    renderProvider();

    expect(screen.getByText("web search off")).toBeTruthy();
  });

  it("restores the open preference and persists later changes", () => {
    storage.setItem(OPEN_KEY, "true");
    renderProvider();

    expect(screen.getByText("open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(storage.getItem(OPEN_KEY)).toBe("false");
  });

  it("defaults closed when browser storage cannot be read", () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    renderProvider();

    expect(screen.getByText("closed")).toBeTruthy();
    expect(storage.getItem).toHaveBeenCalledWith(OPEN_KEY);
  });
});
