import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { defaultModel, findModel, type Model } from "~/lib/models";

export type ContextItem = {
  id: string;
  /** Short label shown on the chip, e.g. an article title. */
  label: string;
  /** What gets sent to the model: page content, a paragraph, etc. */
  content: string;
  kind: "page" | "article" | "paragraph" | "project" | "dataset";
  /** For project context: ties the conversation to that project. */
  projectId?: string;
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
  /** Attach to the composer textarea so addContext can focus it. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
};

const GardenerContext = createContext<GardenerState | null>(null);

const welcome: ChatMessage = {
  id: "welcome",
  role: "gardener",
  text: "Hi, I am The Gardener. I know every article in the learning section and I am happy to help you find or grow a project idea. What are you curious about?",
};

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
  const [open, setOpen] = useState(false);
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

  const addContext = useCallback((item: Omit<ContextItem, "id">) => {
    setContextItems((items) => {
      // One chip per source; re-adding the same label replaces it.
      const rest = items.filter((i) => i.label !== item.label);
      return [...rest, { ...item, id: uid() }];
    });
    setOpen(true);
    // Wait for the panel (or mobile sheet) to render before focusing.
    setTimeout(() => composerRef.current?.focus(), 250);
  }, []);

  const removeContext = useCallback((id: string) => {
    setContextItems((items) => items.filter((i) => i.id !== id));
  }, []);

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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: wireMessages,
          model: modelRef.current.id,
          page: pathnameRef.current,
          context: sentContext,
          projectId,
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
        if (chunk) patchAssistant((msg) => ({ ...msg, text: msg.text + chunk }));
      }
      patchAssistant((msg) =>
        msg.text
          ? msg
          : {
              ...msg,
              text: "I came back empty-handed. Ask again, or try another model?",
              error: true,
            },
      );
    } catch (e) {
      patchAssistant((msg) => ({
        ...msg,
        text:
          e instanceof Error && e.message
            ? e.message
            : "Something went wrong. Try again.",
        error: true,
      }));
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
    // The old thread stays in the database; this just starts a new one.
    void fetch("/api/thread", { method: "POST" });
  }, []);

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
