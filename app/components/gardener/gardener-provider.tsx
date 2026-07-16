import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import type { DatasetSource } from "~/lib/duckdb.client";
import { defaultModel, findModel, type Model } from "~/lib/models";
import {
  datasetSummary,
  MAX_CONTINUATIONS,
  type DatasetInfo,
} from "~/lib/query-tool";
import { queryResultNote, splitToolNotes } from "~/lib/tool-notes";

export type ContextItem = {
  id: string;
  /** Short label shown on the chip, e.g. an article title. */
  label: string;
  /** What gets sent to the model: page content, a paragraph, etc. */
  content: string;
  kind: "page" | "article" | "module" | "paragraph" | "project" | "dataset";
  /** For project context: ties the conversation to that project. */
  projectId?: string;
  /** For dataset context: removing the chip also drops the DuckDB view. */
  datasetName?: string;
};

/** Context that was attached to a sent message, for display. */
export type ContextSnapshot = {
  kind: ContextItem["kind"];
  label: string;
  content: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "gardener";
  text: string;
  error?: boolean;
  context?: ContextSnapshot[];
};

export type GardenerState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  busy: boolean;
  contextItems: ContextItem[];
  addContext: (item: Omit<ContextItem, "id">) => void;
  removeContext: (id: string) => void;
  ask: (question: string) => void;
  /** Like ask, but in a brand-new conversation (the old one is kept). */
  askFresh: (
    question: string,
    context?: Omit<ContextItem, "id">[],
  ) => void;
  clearConversation: () => void;
  /**
   * Swap the sidebar over to an existing conversation and open it,
   * optionally asking a question right away.
   */
  resumeConversation: (messages: ChatMessage[], question?: string) => void;
  /**
   * A freshly planted project: start a linked conversation and ask the
   * Gardener to react to it. The caller must have already created the
   * linked thread via POST /api/thread {projectId}.
   */
  plantProject: (project: {
    title: string;
    oneLiner?: string | null;
    modules?: string[];
  }) => void;
  model: Model;
  setModel: (model: Model) => void;
  /** Web search via the OpenRouter web plugin; off by default (it costs). */
  webSearch: boolean;
  setWebSearch: (on: boolean) => void;
  /** Datasets loaded into the browser's DuckDB for the query_data tool. */
  datasets: DatasetInfo[];
  /** Label of the dataset currently being loaded, if any. */
  attachingDataset: string | null;
  attachDataset: (source: DatasetSource) => Promise<void>;
  removeDataset: (name: string) => void;
  /** Attach to the composer textarea so addContext can focus it. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
};

const GardenerContext = createContext<GardenerState | null>(null);

const welcome: ChatMessage = {
  id: "welcome",
  role: "gardener",
  text: "Hi, I am The Gardener. I know every article in the learning section and I am happy to help you find or grow a project idea. What are you curious about?",
};

const OPEN_KEY = "vg-gardener-open";

function readOpenPreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

let nextId = 0;
const uid = () => `m${Date.now()}-${++nextId}`;

export function GardenerProvider({
  children,
  initialMessages,
  initialModelId,
}: {
  children: React.ReactNode;
  initialMessages?: ChatMessage[];
  initialModelId?: string | null;
}) {
  // Start closed on both server and client, then apply the saved
  // preference after mount: reading localStorage during render makes the
  // SSR HTML disagree with the first client render (hydration mismatch).
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    if (readOpenPreference()) setOpenState(true);
  }, []);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages && initialMessages.length > 0
      ? initialMessages
      : [welcome],
  );
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [model, setModel] = useState<Model>(
    () => findModel(initialModelId) ?? defaultModel,
  );
  const [webSearch, setWebSearch] = useState(false);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [attachingDataset, setAttachingDataset] = useState<string | null>(
    null,
  );

  const { pathname } = useLocation();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Refs mirror state so ask() always sees the latest values without
  // re-creating its identity on every keystroke of a stream.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const contextRef = useRef(contextItems);
  contextRef.current = contextItems;
  const modelRef = useRef(model);
  modelRef.current = model;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const webSearchRef = useRef(webSearch);
  webSearchRef.current = webSearch;
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  const setOpen = useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen);
    try {
      window.localStorage.setItem(OPEN_KEY, String(nextOpen));
    } catch {
      // Storage may be unavailable; preserve the in-memory panel state.
    }
  }, []);

  const addContext = useCallback((item: Omit<ContextItem, "id">) => {
    // One chip per source; re-adding the same label replaces it. The ref is
    // synced now (not on the next render) so an immediate ask() sees it.
    const rest = contextRef.current.filter((i) => i.label !== item.label);
    const next = [...rest, { ...item, id: uid() }];
    contextRef.current = next;
    setContextItems(next);
    setOpen(true);
    // Wait for the panel (or mobile sheet) to render before focusing.
    setTimeout(() => composerRef.current?.focus(), 250);
  }, []);

  const removeDataset = useCallback((name: string) => {
    setDatasets((d) => d.filter((x) => x.name !== name));
    setContextItems((items) => items.filter((i) => i.datasetName !== name));
    void import("~/lib/duckdb.client").then(({ dropDataset }) =>
      dropDataset(name),
    );
  }, []);

  const removeContext = useCallback(
    (id: string) => {
      const item = contextRef.current.find((i) => i.id === id);
      if (item?.datasetName) {
        // Removing the pending chip un-attaches the dataset entirely.
        removeDataset(item.datasetName);
        return;
      }
      setContextItems((items) => items.filter((i) => i.id !== id));
    },
    [removeDataset],
  );

  /** Datasets belong to one conversation; a fresh one starts clean. */
  const clearDatasets = useCallback(() => {
    for (const d of datasetsRef.current) {
      void import("~/lib/duckdb.client").then(({ dropDataset }) =>
        dropDataset(d.name),
      );
    }
    setDatasets([]);
    datasetsRef.current = [];
  }, []);

  const attachDataset = useCallback(async (source: DatasetSource) => {
    const label =
      source.kind === "file"
        ? source.file.name
        : source.url.split("/").pop() || source.url;
    setAttachingDataset(label);
    setOpen(true);
    try {
      // Lazy: DuckDB-WASM only loads when someone actually attaches data.
      const { registerDataset } = await import("~/lib/duckdb.client");
      const info = await registerDataset(source);
      // Sync the ref now so a send() that attached then immediately asks
      // includes this dataset's schema in the request.
      const next = [
        ...datasetsRef.current.filter((x) => x.name !== info.name),
        info,
      ];
      datasetsRef.current = next;
      setDatasets(next);
      // The attachment rides on the next message as a context quote (the
      // schema itself travels separately, via the datasets request field).
      addContext({
        kind: "dataset",
        label: `${info.name} (${info.rowCount.toLocaleString()} rows)`,
        content: `Attached ${info.label}: ${info.columns.length} columns, queryable with SQL.`,
        datasetName: info.name,
      });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "The data could not be loaded.",
      );
    } finally {
      setAttachingDataset(null);
    }
  }, [addContext]);

  const ask = useCallback(async (question: string) => {
    const sentContext = contextRef.current.map(
      ({ kind, label, content }) => ({ kind, label, content }),
    );
    const projectId = contextRef.current.find((i) => i.projectId)?.projectId;
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text: question,
      context: sentContext.length > 0 ? sentContext : undefined,
    };
    const assistantId = uid();

    const wireMessages = [...messagesRef.current, userMsg]
      .filter((m) => m.id !== "welcome" && !m.error)
      .map((m) => ({
        role: m.role === "gardener" ? ("assistant" as const) : ("user" as const),
        content: m.text,
      }));

    setContextItems([]);
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "gardener", text: "" },
    ]);
    setBusy(true);

    const patchAssistant = (patch: (msg: ChatMessage) => ChatMessage) =>
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? patch(msg) : msg)),
      );

    // The whole answer, across the primary turn and any query
    // continuations; it mirrors what patchAssistant has rendered.
    let text = "";
    const append = (chunk: string) => {
      text += chunk;
      patchAssistant((msg) => ({ ...msg, text }));
    };

    type Wire = { role: "user" | "assistant" | "data"; content: string };
    const streamTurn = async (messages: Wire[], continuation: boolean) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          continuation,
          model: modelRef.current.id,
          page: pathnameRef.current,
          context: sentContext,
          projectId,
          web: webSearchRef.current,
          datasets: datasetsRef.current.map((d) => ({
            name: d.name,
            summary: datasetSummary(d),
          })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          err?.error ?? "The Gardener could not answer just now.",
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) append(chunk);
      }
    };

    try {
      await streamTurn(wireMessages, false);
      if (!text) {
        patchAssistant((msg) => ({
          ...msg,
          text: "I came back empty-handed. Ask again, or try another model?",
          error: true,
        }));
        return;
      }
    } catch (e) {
      patchAssistant((msg) => ({
        ...msg,
        text:
          e instanceof Error && e.message
            ? e.message
            : "Something went wrong. Try again.",
        error: true,
      }));
      setBusy(false);
      return;
    }

    // The turn may end on a query marker: run the SQL in the browser,
    // fold the result into the same bubble, and let the model narrate it
    // in a hidden continuation turn. Capped so a stubborn model cannot
    // loop query after query.
    try {
      for (let i = 0; i < MAX_CONTINUATIONS; i++) {
        const last = splitToolNotes(text).at(-1);
        if (last?.type !== "query") break;
        // The assistant turn sent as history stops at the query marker; the
        // result travels only in the data message, so the model is not fed
        // a pre-summarized result line it would otherwise parrot back.
        const historyText = text;
        const { runQuery } = await import("~/lib/duckdb.client");
        const envelope = await runQuery(last.sql);
        append(`\n\n${queryResultNote(envelope)}\n\n`);
        await streamTurn(
          [
            ...wireMessages,
            { role: "assistant", content: historyText },
            { role: "data", content: JSON.stringify(envelope) },
          ],
          true,
        );
      }
      // Never leave the answer on a bare table or error card: if the model
      // ran out of continuations, or fell silent after a result, close with
      // a short line so the person is not staring at an unexplained result.
      const tail = splitToolNotes(text).at(-1);
      if (tail?.type === "query") {
        append(
          "\n\nI could not get that query to run after a few tries. Want to rephrase, or try a simpler question about the data?",
        );
      } else if (tail?.type === "queryresult") {
        append(
          tail.result.status === "error"
            ? "\n\nThat query did not run against your data. Want me to try a different angle?"
            : "\n\nThe table above has your answer.",
        );
      }
    } catch (e) {
      console.error("query continuation failed", e);
      append(
        "\n\nI ran the query, but lost the connection while reading the results. Ask again?",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const askFresh = useCallback(
    async (
      question: string,
      context: Omit<ContextItem, "id">[] = [],
    ) => {
      messagesRef.current = [welcome];
      setMessages([welcome]);
      clearDatasets();
      const seededContext = context.map((item) => ({ ...item, id: uid() }));
      contextRef.current = seededContext;
      setContextItems(seededContext);
      setOpen(true);
      // The new thread must exist before the chat request picks a thread.
      await fetch("/api/thread", { method: "POST" });
      ask(question);
    },
    [ask],
  );

  const resumeConversation = useCallback(
    (msgs: ChatMessage[], question?: string) => {
      // Sync the ref immediately so an instant ask() sees the right history.
      messagesRef.current = msgs;
      setMessages(msgs);
      setContextItems([]);
      setOpen(true);
      const trimmed = question?.trim();
      if (trimmed) {
        ask(trimmed);
      } else {
        setTimeout(() => composerRef.current?.focus(), 250);
      }
    },
    [ask],
  );

  const plantProject = useCallback(
    (project: {
      title: string;
      oneLiner?: string | null;
      modules?: string[];
    }) => {
      const description = [
        `Project: ${project.title}`,
        project.oneLiner ? `Idea: ${project.oneLiner}` : null,
        project.modules?.length
          ? `Building blocks: ${project.modules.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      // Fresh conversation for this project; the linked thread was already
      // created server-side, so ask() lands on it.
      messagesRef.current = [welcome];
      setMessages([welcome]);
      clearDatasets();
      contextRef.current = [
        {
          id: uid(),
          kind: "project",
          label: project.title,
          content: description,
        },
      ];
      setContextItems([]);
      setOpen(true);
      ask(
        "I just planted this idea in my garden. What do you think? Give me a couple of creative directions, a tiny first step, and anything worth reading.",
      );
    },
    [ask],
  );

  const clearConversation = useCallback(() => {
    setMessages([welcome]);
    setContextItems([]);
    clearDatasets();
    // The old thread stays in the database; this just starts a new one.
    void fetch("/api/thread", { method: "POST" });
  }, [clearDatasets]);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      messages,
      busy,
      contextItems,
      addContext,
      removeContext,
      ask,
      askFresh,
      clearConversation,
      resumeConversation,
      plantProject,
      model,
      setModel,
      webSearch,
      setWebSearch,
      datasets,
      attachingDataset,
      attachDataset,
      removeDataset,
      composerRef,
    }),
    [
      open,
      messages,
      busy,
      contextItems,
      addContext,
      removeContext,
      ask,
      askFresh,
      clearConversation,
      resumeConversation,
      plantProject,
      model,
      webSearch,
      datasets,
      attachingDataset,
      attachDataset,
      removeDataset,
    ],
  );

  return (
    <GardenerContext.Provider value={value}>
      {children}
    </GardenerContext.Provider>
  );
}

export function useOptionalGardener() {
  return useContext(GardenerContext);
}

export function useGardener() {
  const ctx = useOptionalGardener();
  if (!ctx) throw new Error("useGardener must be used inside GardenerProvider");
  return ctx;
}
