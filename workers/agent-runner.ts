import { buildPermissionsPolicy } from "../app/lib/artifacts/policy";

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "vibegarden.test", "usercontent.vibegarden.test"]);

function explicitParentOrigin(value: string): string {
  if (typeof value !== "string") throw new Error("Agent runner parent origin is invalid.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agent runner parent origin is invalid.");
  }
  const localHttp = url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    !url.hostname ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Agent runner parent origin is invalid.");
  }
  return url.origin;
}

export const AGENT_RUNNER_SCRIPT = `"use strict";
let activeExecution = null;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(value) {
  try {
    if (value && typeof value.message === "string") return value.message.slice(0, 1000);
    return String(value).slice(0, 1000);
  } catch {
    return "Tool execution failed.";
  }
}

function workerMain() {
  "use strict";
  const NativeError = Error;
  const NativeFunction = Function;
  const NativeMap = Map;
  const NativePromise = Promise;
  const arrayPush = Function.call.bind(Array.prototype.push);
  const defineProperty = Object.defineProperty.bind(Object);
  const freeze = Object.freeze.bind(Object);
  const mapDelete = Function.call.bind(Map.prototype.delete);
  const mapGet = Function.call.bind(Map.prototype.get);
  const mapHas = Function.call.bind(Map.prototype.has);
  const mapSet = Function.call.bind(Map.prototype.set);
  const safeString = String;
  const stringSlice = Function.call.bind(String.prototype.slice);
  const stringify = JSON.stringify.bind(JSON);

  function safeErrorMessage(value) {
    try {
      if (value && typeof value.message === "string") return stringSlice(value.message, 0, 1000);
      return stringSlice(safeString(value), 0, 1000);
    } catch {
      return "Tool execution failed.";
    }
  }

  function installExecutionGlobals() {
    const blockedParent = {};
    defineProperty(blockedParent, "document", {
      configurable: false,
      get: () => { throw new NativeError("Parent document access is not available."); },
    });
    freeze(blockedParent);
    const safeWindow = freeze({ parent: blockedParent });
    const safeDocument = freeze({ cookie: "" });
    const blockedGlobal = (name) => () => { throw new NativeError(name + " is not available. Use the declared env capabilities."); };
    for (const [name, value] of [
      ["window", safeWindow],
      ["document", safeDocument],
      ["postMessage", blockedGlobal("postMessage")],
      ["close", blockedGlobal("close")],
      ["importScripts", blockedGlobal("importScripts")],
    ]) {
      try {
        defineProperty(globalThis, name, { configurable: false, enumerable: false, value, writable: false });
      } catch {}
    }
  }

  self.addEventListener("message", async (event) => {
    const msg = event.data;
    const port = event.ports && event.ports[0];
    if (
      !port ||
      !msg ||
      msg.type !== "start" ||
      typeof msg.id !== "string" ||
      typeof msg.source !== "string" ||
      !msg.args ||
      typeof msg.args !== "object" ||
      Array.isArray(msg.args)
    ) return;

    const id = msg.id;
    const source = msg.source;
    const args = msg.args;
    const logs = [];
    const pending = new NativeMap();
    let callSequence = 0;
    const send = port.postMessage.bind(port);

    port.addEventListener("message", (hostEvent) => {
      const hostResult = hostEvent.data;
      if (
        !hostResult ||
        hostResult.type !== "host-result" ||
        typeof hostResult.callId !== "string" ||
        typeof hostResult.ok !== "boolean" ||
        !mapHas(pending, hostResult.callId)
      ) return;
      const entry = mapGet(pending, hostResult.callId);
      mapDelete(pending, hostResult.callId);
      if (hostResult.ok) entry.resolve(hostResult.value);
      else entry.reject(new NativeError(typeof hostResult.error === "string" && hostResult.error ? stringSlice(hostResult.error, 0, 1000) : "Host call failed."));
    });
    port.start();

    function hostCall(method, params) {
      const callId = id + ":" + callSequence;
      callSequence += 1;
      return new NativePromise((resolve, reject) => {
        mapSet(pending, callId, { resolve, reject });
        try {
          send({ type: "host", id, callId, method, params });
        } catch (error) {
          mapDelete(pending, callId);
          reject(error);
        }
      });
    }

    const memory = freeze({
      get: (key) => hostCall("memoryGet", [key]),
      set: (key, value) => hostCall("memorySet", [key, value]),
      list: () => hostCall("memoryList", []),
    });
    const env = freeze({
      fetchPage: (url) => hostCall("fetchPage", [url]),
      memory,
      log: (line) => {
        if (logs.length < 50) arrayPush(logs, stringSlice(safeString(line), 0, 500));
      },
    });

    installExecutionGlobals();
    try {
      const fn = new NativeFunction("args", "env", '"use strict"; return (async () => {\\n' + source + "\\n})();");
      const value = await fn(args, env);
      const serialized = stringify(value ?? null);
      if (typeof serialized !== "string") throw new NativeError("Tool result is not JSON-serializable.");
      send({ type: "result", id, ok: true, value: serialized, logs });
    } catch (error) {
      send({ type: "result", id, ok: false, error: safeErrorMessage(error), logs });
    }
  }, { once: true });
}

function releaseExecution(execution) {
  if (activeExecution !== execution) return;
  activeExecution = null;
  try { execution.port.close(); } catch {}
  try { execution.worker.terminate(); } catch {}
  URL.revokeObjectURL(execution.url);
}

function finishExecution(execution, result) {
  if (activeExecution !== execution) return;
  releaseExecution(execution);
  window.parent.postMessage(result, "*");
}

function startExecution(id, source, args) {
  const workerSource = "(" + workerMain.toString() + ")();";
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(url);
  const channel = new MessageChannel();
  const execution = { id, pending: new Set(), port: channel.port1, url, worker };
  activeExecution = execution;

  channel.port1.addEventListener("message", (event) => {
    const msg = event.data;
    if (activeExecution !== execution || !isRecord(msg) || msg.id !== id) return;
    if (
      msg.type === "host" &&
      typeof msg.callId === "string" &&
      (msg.method === "fetchPage" || msg.method === "memoryGet" || msg.method === "memorySet" || msg.method === "memoryList") &&
      Array.isArray(msg.params)
    ) {
      execution.pending.add(msg.callId);
      window.parent.postMessage({ type: "host", id, callId: msg.callId, method: msg.method, params: msg.params }, "*");
      return;
    }
    if (
      msg.type === "result" &&
      typeof msg.ok === "boolean" &&
      Array.isArray(msg.logs) &&
      msg.logs.length <= 50 &&
      msg.logs.every((line) => typeof line === "string" && line.length <= 500) &&
      (msg.ok ? typeof msg.value === "string" : typeof msg.error === "string")
    ) {
      finishExecution(execution, msg);
    }
  });
  channel.port1.start();
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    finishExecution(execution, { type: "result", id, ok: false, error: errorMessage(event.error || event.message), logs: [] });
  });
  worker.postMessage({ type: "start", id, source, args }, [channel.port2]);
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (
    isRecord(msg) &&
    msg.type === "host-result" &&
    typeof msg.callId === "string" &&
    typeof msg.ok === "boolean" &&
    activeExecution &&
    activeExecution.pending.has(msg.callId)
  ) {
    activeExecution.pending.delete(msg.callId);
    activeExecution.port.postMessage({
      type: "host-result",
      callId: msg.callId,
      ok: msg.ok,
      ...(msg.ok ? { value: msg.value } : { error: typeof msg.error === "string" ? msg.error.slice(0, 1000) : "Host call failed." }),
    });
    return;
  }
  if (
    !isRecord(msg) ||
    msg.type !== "execute" ||
    typeof msg.id !== "string" ||
    typeof msg.source !== "string" ||
    !isRecord(msg.args)
  ) return;
  if (activeExecution) {
    window.parent.postMessage({ type: "result", id: msg.id, ok: false, error: "Runner is busy with another call.", logs: [] }, "*");
    return;
  }
  startExecution(msg.id, msg.source, msg.args);
});

window.parent.postMessage({ type: "ready" }, "*");`;

export const AGENT_RUNNER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Agent tool runner</title>
  </head>
  <body>
    <script>${AGENT_RUNNER_SCRIPT}</script>
  </body>
</html>`;

function runnerCsp(parentOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src blob:",
    `frame-ancestors ${explicitParentOrigin(parentOrigin)}`,
  ].join("; ");
}

export function handleAgentRunnerRequest(parentOrigin: string): Response {
  return new Response(AGENT_RUNNER_HTML, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": runnerCsp(parentOrigin),
      "Content-Type": "text/html; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-site",
      "Permissions-Policy": buildPermissionsPolicy(),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
