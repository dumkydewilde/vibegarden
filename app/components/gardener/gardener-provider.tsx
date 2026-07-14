import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ContextItem = {
  id: string;
  /** Short label shown on the chip, e.g. an article title. */
  label: string;
  /** What gets sent to the model: page content, a paragraph, etc. */
  content: string;
  kind: "page" | "article" | "paragraph";
};

export type ChatMessage = {
  id: string;
  role: "user" | "gardener";
  text: string;
};

export type Model = {
  id: string;
  label: string;
  note: string;
};

// Placeholder list; wired to OpenRouter in phase 3.
export const models: Model[] = [
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", note: "default" },
  { id: "deepseek/deepseek-v4", label: "DeepSeek V4", note: "thorough" },
  { id: "qwen/qwen-3.7", label: "Qwen 3.7", note: "fast" },
];

type GardenerState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  contextItems: ContextItem[];
  addContext: (item: Omit<ContextItem, "id">) => void;
  removeContext: (id: string) => void;
  ask: (question: string) => void;
  model: Model;
  setModel: (model: Model) => void;
};

const GardenerContext = createContext<GardenerState | null>(null);

const welcome: ChatMessage = {
  id: "welcome",
  role: "gardener",
  text: "Hi, I am The Gardener. I know every article in the learning section and I am happy to help you find or grow a project idea. What are you curious about?",
};

let nextId = 0;
const uid = () => `m${++nextId}`;

export function GardenerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [model, setModel] = useState<Model>(models[0]);

  const addContext = useCallback((item: Omit<ContextItem, "id">) => {
    setContextItems((items) => {
      // One chip per source; re-adding the same label replaces it.
      const rest = items.filter((i) => i.label !== item.label);
      return [...rest, { ...item, id: uid() }];
    });
    setOpen(true);
  }, []);

  const removeContext = useCallback((id: string) => {
    setContextItems((items) => items.filter((i) => i.id !== id));
  }, []);

  // Stub until the OpenRouter backend lands in phase 3.
  const ask = useCallback((question: string) => {
    setMessages((m) => [
      ...m,
      { id: uid(), role: "user", text: question },
      {
        id: uid(),
        role: "gardener",
        text: "I am still growing my roots: real answers arrive when my connection to the language model lands in phase 3. Your question and context are safe with me in the meantime.",
      },
    ]);
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      messages,
      contextItems,
      addContext,
      removeContext,
      ask,
      model,
      setModel,
    }),
    [open, messages, contextItems, addContext, removeContext, ask, model],
  );

  return (
    <GardenerContext.Provider value={value}>
      {children}
    </GardenerContext.Provider>
  );
}

export function useGardener() {
  const ctx = useContext(GardenerContext);
  if (!ctx) throw new Error("useGardener must be used inside GardenerProvider");
  return ctx;
}
