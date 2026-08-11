export type HostHandlers = {
  fetchPage: (url: string) => Promise<unknown>;
  memoryGet: (key: string) => Promise<unknown>;
  memorySet: (key: string, value: string) => Promise<unknown>;
  memoryList: () => Promise<unknown>;
};

export type RunnerResult =
  | { ok: true; value: string; logs: string[] }
  | { ok: false; error: string; logs: string[] };

export const RUN_TIMEOUT_MS = 10_000;

const RUNNER_PATH = "/agent-runner";
const LOCAL_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "usercontent.vibegarden.test",
]);

type FrameState = {
  element: HTMLIFrameElement;
  source: Window;
  ready: boolean;
};

type ActiveRun = {
  frame: FrameState;
  hostCalls: Set<string>;
  id: string;
  source: string;
  args: Record<string, unknown>;
  started: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: RunnerResult) => void;
};

type HostMessage = {
  type: "host";
  id: string;
  callId: string;
  method: keyof HostHandlers;
  params: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function validRunnerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agent runner URL is invalid.");
  }

  const localHttp = url.protocol === "http:"
    && LOCAL_HTTP_HOSTS.has(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    !url.hostname ||
    url.hostname.includes("*") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== RUNNER_PATH ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Agent runner URL is invalid.");
  }
  return url.href;
}

function safeErrorMessage(value: unknown): string {
  try {
    if (isRecord(value) && typeof value.message === "string" && value.message) {
      return value.message.slice(0, 1000);
    }
    return String(value).slice(0, 1000) || "Host call failed.";
  } catch {
    return "Host call failed.";
  }
}

function validLogs(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 50
    && value.every((line) => typeof line === "string" && line.length <= 500);
}

function parseResultMessage(value: unknown, id: string): RunnerResult | null {
  if (
    !isRecord(value)
    || value.type !== "result"
    || value.id !== id
    || typeof value.ok !== "boolean"
  ) {
    return null;
  }
  if (value.ok) {
    if (
      !hasExactKeys(value, ["type", "id", "ok", "value", "logs"])
      || typeof value.value !== "string"
      || !validLogs(value.logs)
    ) return null;
    return { ok: true, value: value.value, logs: [...value.logs] };
  }
  if (
    !hasExactKeys(value, ["type", "id", "ok", "error", "logs"])
    || typeof value.error !== "string"
    || value.error.length > 1000
    || !validLogs(value.logs)
  ) return null;
  return { ok: false, error: value.error, logs: [...value.logs] };
}

function parseHostMessage(value: unknown, id: string): HostMessage | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["type", "id", "callId", "method", "params"])
    || value.type !== "host"
    || value.id !== id
    || typeof value.callId !== "string"
    || value.callId.length === 0
    || value.callId.length > 256
    || !Array.isArray(value.params)
  ) return null;

  const params = value.params;
  switch (value.method) {
    case "fetchPage":
    case "memoryGet":
      if (params.length !== 1 || typeof params[0] !== "string") return null;
      break;
    case "memorySet":
      if (
        params.length !== 2
        || typeof params[0] !== "string"
        || typeof params[1] !== "string"
      ) return null;
      break;
    case "memoryList":
      if (params.length !== 0) return null;
      break;
    default:
      return null;
  }

  return value as HostMessage;
}

function isReadyMessage(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["type"])
    && value.type === "ready";
}

function invokeHost(host: HostHandlers, message: HostMessage): Promise<unknown> {
  switch (message.method) {
    case "fetchPage":
      return host.fetchPage(message.params[0] as string);
    case "memoryGet":
      return host.memoryGet(message.params[0] as string);
    case "memorySet":
      return host.memorySet(
        message.params[0] as string,
        message.params[1] as string,
      );
    case "memoryList":
      return host.memoryList();
  }
}

export function createRunner(opts: { runnerUrl: string; host: HostHandlers }): {
  run: (source: string, args: Record<string, unknown>) => Promise<RunnerResult>;
  dispose: () => void;
} {
  const runnerUrl = validRunnerUrl(opts.runnerUrl);
  let active: ActiveRun | null = null;
  let currentFrame: FrameState | null = null;
  let disposed = false;
  let runSequence = 0;
  let queue: Promise<void> = Promise.resolve();

  const createFrame = (): FrameState => {
    const element = document.createElement("iframe");
    element.title = "Agent tool runner";
    element.hidden = true;
    element.tabIndex = -1;
    element.setAttribute("sandbox", "allow-scripts");
    element.src = runnerUrl;
    document.body.append(element);
    const source = element.contentWindow;
    if (!source) {
      element.remove();
      throw new Error("Agent runner frame is unavailable.");
    }
    const state = { element, source, ready: false };
    currentFrame = state;
    return state;
  };

  const ensureFrame = (): FrameState => currentFrame ?? createFrame();

  const removeFrame = (): void => {
    currentFrame?.element.remove();
    currentFrame = null;
  };

  const postToFrame = (frame: FrameState, message: unknown): void => {
    // A sandbox without allow-same-origin has an opaque origin, so the
    // protocol requires a wildcard target and authenticates by WindowProxy.
    frame.source.postMessage(message, "*");
  };

  const finish = (run: ActiveRun, result: RunnerResult): void => {
    if (active !== run) return;
    clearTimeout(run.timer);
    active = null;
    run.resolve(result);
  };

  const replaceFrame = (): void => {
    removeFrame();
    if (!disposed) createFrame();
  };

  const begin = (run: ActiveRun): void => {
    if (active !== run || run.started || !run.frame.ready) return;
    run.started = true;
    try {
      postToFrame(run.frame, {
        type: "execute",
        id: run.id,
        source: run.source,
        args: run.args,
      });
    } catch {
      finish(run, { ok: false, error: "Tool runner is unavailable.", logs: [] });
      replaceFrame();
    }
  };

  const postHostResult = (
    run: ActiveRun,
    callId: string,
    result: { ok: true; value: unknown } | { ok: false; error: string },
  ): void => {
    if (
      active !== run
      || currentFrame !== run.frame
      || !run.hostCalls.delete(callId)
    ) return;
    try {
      postToFrame(run.frame, {
        type: "host-result",
        callId,
        ...result,
      });
    } catch {
      finish(run, { ok: false, error: "Tool runner is unavailable.", logs: [] });
      replaceFrame();
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    const frame = currentFrame;
    if (!frame || event.source !== frame.source || event.origin !== "null") return;

    try {
      if (isReadyMessage(event.data)) {
        frame.ready = true;
        if (active?.frame === frame) begin(active);
        return;
      }

      const run = active;
      if (!run || run.frame !== frame || !run.started) return;
      const result = parseResultMessage(event.data, run.id);
      if (result) {
        finish(run, result);
        return;
      }

      const hostMessage = parseHostMessage(event.data, run.id);
      if (!hostMessage || run.hostCalls.has(hostMessage.callId)) return;
      run.hostCalls.add(hostMessage.callId);
      void Promise.resolve()
        .then(() => invokeHost(opts.host, hostMessage))
        .then(
          (value) => postHostResult(run, hostMessage.callId, { ok: true, value }),
          (error: unknown) => postHostResult(run, hostMessage.callId, {
            ok: false,
            error: safeErrorMessage(error),
          }),
        );
    } catch {
      // Messages are untrusted. Invalid or hostile shapes do not affect a run.
    }
  };

  window.addEventListener("message", onMessage);

  const execute = (
    source: string,
    args: Record<string, unknown>,
  ): Promise<RunnerResult> => {
    if (disposed) {
      return Promise.resolve({ ok: false, error: "Tool runner was disposed.", logs: [] });
    }

    const frame = ensureFrame();
    return new Promise((resolve) => {
      runSequence += 1;
      const run = {
        frame,
        hostCalls: new Set<string>(),
        id: `agent-run-${runSequence}`,
        source,
        args,
        started: false,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        resolve,
      } satisfies ActiveRun;
      run.timer = setTimeout(() => {
        if (active !== run) return;
        finish(run, {
          ok: false,
          error: "Tool timed out after 10 seconds.",
          logs: [],
        });
        replaceFrame();
      }, RUN_TIMEOUT_MS);
      active = run;
      begin(run);
    });
  };

  const run = (source: string, args: Record<string, unknown>): Promise<RunnerResult> => {
    if (!disposed) ensureFrame();
    const result = queue.then(() => execute(source, args));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", onMessage);
    const run = active;
    if (run) finish(run, { ok: false, error: "Tool runner was disposed.", logs: [] });
    removeFrame();
  };

  return { run, dispose };
}
