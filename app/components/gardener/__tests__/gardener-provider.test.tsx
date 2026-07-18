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
  const { open, setOpen } = useGardener();
  return (
    <>
      <span>{open ? "open" : "closed"}</span>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
    </>
  );
}

function renderHarness(context?: Omit<ContextItem, "id">[]) {
  return render(
    <MemoryRouter initialEntries={["/clubs/wotf"]}>
      <Routes>
        <Route
          path="/clubs/:clubSlug/*"
          element={
            <GardenerProvider>
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

describe("GardenerProvider panel preference", () => {
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
