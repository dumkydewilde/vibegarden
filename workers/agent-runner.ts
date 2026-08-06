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
let busy = false;
const pending = new Map();

try {
  Object.defineProperty(document, "cookie", { value: "", writable: false, configurable: false });
} catch {}

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

function hostCall(id, method, params) {
  const callId = id + ":" + pending.size + ":" + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    try {
      window.parent.postMessage({ type: "host", id, callId, method, params }, "*");
    } catch (error) {
      pending.delete(callId);
      reject(error);
    }
  });
}

window.addEventListener("message", async (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (isRecord(msg) && msg.type === "host-result" && typeof msg.callId === "string" && typeof msg.ok === "boolean" && pending.has(msg.callId)) {
    const entry = pending.get(msg.callId);
    pending.delete(msg.callId);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error(typeof msg.error === "string" && msg.error ? msg.error.slice(0, 1000) : "Host call failed."));
    return;
  }
  if (
    !isRecord(msg) ||
    msg.type !== "execute" ||
    typeof msg.id !== "string" ||
    typeof msg.source !== "string" ||
    !isRecord(msg.args)
  ) return;

  const { id, source, args } = msg;
  const logs = [];
  if (busy) {
    window.parent.postMessage({ type: "result", id, ok: false, error: "Runner is busy with another call.", logs }, "*");
    return;
  }

  busy = true;
  const env = {
    fetchPage: (url) => hostCall(id, "fetchPage", [url]),
    memory: {
      get: (key) => hostCall(id, "memoryGet", [key]),
      set: (key, value) => hostCall(id, "memorySet", [key, value]),
      list: () => hostCall(id, "memoryList", []),
    },
    log: (line) => {
      if (logs.length < 50) logs.push(String(line).slice(0, 500));
    },
  };

  try {
    const fn = new Function("args", "env", '"use strict"; return (async () => {\\n' + source + "\\n})();");
    const value = await fn(args, env);
    const serialized = JSON.stringify(value ?? null);
    if (typeof serialized !== "string") throw new Error("Tool result is not JSON-serializable.");
    window.parent.postMessage({ type: "result", id, ok: true, value: serialized, logs }, "*");
  } catch (error) {
    window.parent.postMessage({ type: "result", id, ok: false, error: errorMessage(error), logs }, "*");
  } finally {
    busy = false;
  }
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
    "worker-src 'none'",
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
