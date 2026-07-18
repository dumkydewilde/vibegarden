const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns a stable, privacy-safe identifier for MCP audit and limiter keys. */
export async function hashMcpUser(env: Env, value: string): Promise<string> {
  if (!env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is not set. Locally: put SESSION_SECRET=<any string> in .dev.vars and restart the dev server. Production: wrangler secret put SESSION_SECRET.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toHex(signature).slice(0, 24);
}
