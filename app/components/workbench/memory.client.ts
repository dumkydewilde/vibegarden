export const MEMORY_MAX_ENTRIES = 100;
export const MEMORY_VALUE_MAX_CHARS = 500;

const MEMORY_LIST_MAX_ENTRIES = 20;
const DATABASE_NAME = "vibegarden-agent-memory";
const STORE_NAME = "entries";

type MemoryEntry = {
  k: string;
  key: string;
  value: string;
  at: number;
};

type MemoryStore = {
  get: (k: string) => Promise<MemoryEntry | undefined>;
  replaceNamespace: (
    prefix: string,
    key: string,
    value: string,
  ) => Promise<void>;
  scoped: (prefix: string) => Promise<MemoryEntry[]>;
};

const fallbackEntries = new Map<string, MemoryEntry>();
const writeQueues = new Map<string, Promise<void>>();
let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Agent memory request failed.")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Agent memory update failed.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Agent memory update failed.")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "k" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Agent memory could not open.")),
      { once: true },
    );
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function entriesForPrefix(
  entries: Iterable<MemoryEntry>,
  prefix: string,
): MemoryEntry[] {
  return [...entries].filter((entry) => entry.k.startsWith(prefix));
}

function newestFirst(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.sort((left, right) => right.at - left.at);
}

function nextTimestamp(entries: MemoryEntry[]): number {
  return Math.max(
    Date.now(),
    ...entries.map((entry) => entry.at + 1),
  );
}

function fallbackStore(): MemoryStore {
  return {
    async get(k) {
      return fallbackEntries.get(k);
    },
    async replaceNamespace(prefix, key, value) {
      const scoped = entriesForPrefix(fallbackEntries.values(), prefix);
      const entry = {
        k: `${prefix}${key}`,
        key,
        value,
        at: nextTimestamp(scoped),
      };
      fallbackEntries.set(entry.k, entry);
      const retained = newestFirst(entriesForPrefix(fallbackEntries.values(), prefix));
      for (const evicted of retained.slice(MEMORY_MAX_ENTRIES)) {
        fallbackEntries.delete(evicted.k);
      }
    },
    async scoped(prefix) {
      return entriesForPrefix(fallbackEntries.values(), prefix);
    },
  };
}

function indexedDbStore(): MemoryStore {
  return {
    async get(k) {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      return requestResult<MemoryEntry | undefined>(
        transaction.objectStore(STORE_NAME).get(k),
      );
    },
    async replaceNamespace(prefix, key, value) {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const allEntries = await requestResult<MemoryEntry[]>(store.getAll());
      const scoped = entriesForPrefix(allEntries, prefix);
      const entry = {
        k: `${prefix}${key}`,
        key,
        value,
        at: nextTimestamp(scoped),
      };
      store.put(entry);
      const retained = newestFirst([
        ...scoped.filter((stored) => stored.k !== entry.k),
        entry,
      ]);
      for (const evicted of retained.slice(MEMORY_MAX_ENTRIES)) {
        store.delete(evicted.k);
      }
      await transactionDone(transaction);
    },
    async scoped(prefix) {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      const entries = await requestResult<MemoryEntry[]>(
        transaction.objectStore(STORE_NAME).getAll(),
      );
      return entriesForPrefix(entries, prefix);
    },
  };
}

function memoryStore(): MemoryStore {
  return typeof indexedDB === "undefined" ? fallbackStore() : indexedDbStore();
}

function queueWrite(prefix: string, write: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(prefix) ?? Promise.resolve();
  const pending = previous.then(write, write);
  writeQueues.set(prefix, pending);
  void pending.then(
    () => {
      if (writeQueues.get(prefix) === pending) writeQueues.delete(prefix);
    },
    () => {
      if (writeQueues.get(prefix) === pending) writeQueues.delete(prefix);
    },
  );
  return pending;
}

export function agentMemory(agentId: string, userId: string): {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  list: () => Promise<{ key: string; value: string }[]>;
} {
  const prefix = `${agentId}:${userId}:`;
  const store = memoryStore();

  return {
    async get(key) {
      return (await store.get(`${prefix}${key}`))?.value ?? null;
    },
    async set(key, value) {
      if (value.length > MEMORY_VALUE_MAX_CHARS) {
        throw new Error(
          `Memory values must be ${MEMORY_VALUE_MAX_CHARS} characters or fewer.`,
        );
      }
      await queueWrite(prefix, () => store.replaceNamespace(prefix, key, value));
    },
    async list() {
      return newestFirst(await store.scoped(prefix))
        .slice(0, MEMORY_LIST_MAX_ENTRIES)
        .map(({ key, value }) => ({ key, value }));
    },
  };
}
