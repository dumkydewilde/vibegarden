/** Server-side URL, response, and body guards for the workbench fetch proxy. */

export const FETCH_BODY_MAX_BYTES = 1_000_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_REDIRECTS = 3;

type FetchUrlResult =
  | { url: URL; error?: never }
  | { url?: never; error: string };

const PRIVATE_ADDRESS_ERROR =
  "That address points at a private network, which the fetch tool does not reach.";

/** Reject URL shapes that could reach local services or Vibe Garden itself. */
export function checkFetchUrl(raw: string): FetchUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That is not a valid URL. Enter a full HTTPS address." };
  }

  if (url.protocol !== "https:") {
    return { error: "Only HTTPS addresses can be fetched." };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  const isIpv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const isIpv6Literal = url.hostname.includes("[");
  const isPrivateName =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "internal" ||
    hostname.endsWith(".internal");
  const isVibeGardenHost =
    hostname === "vibegarden.club" || hostname.endsWith(".vibegarden.club");

  if (isIpv4Literal || isIpv6Literal || isPrivateName || isVibeGardenHost) {
    return { error: PRIVATE_ADDRESS_ERROR };
  }

  return { url };
}

function capDecodedText(body: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(body).byteLength <= maxBytes) return body;

  const capped = new Uint8Array(maxBytes);
  const { written } = encoder.encodeInto(body, capped);
  return new TextDecoder().decode(capped.subarray(0, written));
}

/** Allow response types that can be usefully exposed as text to a tool. */
export function isAllowedContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml")
  );
}

/** Read at most maxBytes while tracking all characters in chunks read before cancellation. */
export async function readCappedText(
  response: Response,
  maxBytes = FETCH_BODY_MAX_BYTES,
): Promise<{ body: string; totalChars: number; truncated: boolean }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("The fetch body byte limit must be a non-negative safe integer.");
  }
  if (response.body === null) {
    return { body: "", totalChars: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const bodyDecoder = new TextDecoder();
  const totalDecoder = new TextDecoder();
  let body = "";
  let totalChars = 0;
  let bytesKept = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        body += bodyDecoder.decode();
        totalChars += totalDecoder.decode().length;
        return { body, totalChars, truncated: false };
      }

      totalChars += totalDecoder.decode(value, { stream: true }).length;
      const remaining = maxBytes - bytesKept;
      if (value.byteLength <= remaining) {
        body += bodyDecoder.decode(value, { stream: true });
        bytesKept += value.byteLength;
        continue;
      }

      if (remaining > 0) {
        body += bodyDecoder.decode(value.subarray(0, remaining), { stream: true });
        bytesKept += remaining;
      }
      body = capDecodedText(body, maxBytes);
      totalChars += totalDecoder.decode().length;
      try {
        await reader.cancel();
      } catch {
        // A failed cleanup must not replace the successfully capped result.
      }
      return { body, totalChars, truncated: true };
    }
  } finally {
    reader.releaseLock();
  }
}

export type ProxyResult =
  | {
      ok: true;
      status: number;
      contentType: string;
      body: string;
      totalChars: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Fetch a text response while reapplying the URL guard to every redirect. */
export async function proxyFetch(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxyResult> {
  const checked = checkFetchUrl(raw);
  if (checked.error) return { ok: false, error: checked.error };

  let currentUrl = checked.url;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    for (let requestIndex = 0; requestIndex <= FETCH_MAX_REDIRECTS; requestIndex += 1) {
      const response = await fetchImpl(currentUrl.toString(), {
        redirect: "manual",
        signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            ok: false,
            error: "That page returned a redirect without a destination.",
          };
        }
        let redirectedUrl: URL;
        try {
          redirectedUrl = new URL(location, currentUrl);
        } catch {
          return {
            ok: false,
            error: "That page redirected to an invalid address, so the fetch was stopped.",
          };
        }
        const redirectCheck = checkFetchUrl(redirectedUrl.toString());
        if (redirectCheck.error) return { ok: false, error: redirectCheck.error };
        if (requestIndex === FETCH_MAX_REDIRECTS) {
          return {
            ok: false,
            error: `That page redirected more than ${FETCH_MAX_REDIRECTS} times, so the fetch was stopped.`,
          };
        }
        currentUrl = redirectCheck.url;
        continue;
      }

      const contentType = response.headers.get("content-type");
      if (!isAllowedContentType(contentType)) {
        return {
          ok: false,
          error: "That page did not return readable text, JSON, or XML.",
        };
      }

      const capped = await readCappedText(response);
      return {
        ok: true,
        status: response.status,
        contentType: contentType ?? "",
        ...capped,
      };
    }
  } catch {
    if (signal.aborted) {
      return {
        ok: false,
        error: `The fetch took longer than ${FETCH_TIMEOUT_MS / 1_000} seconds and was stopped.`,
      };
    }
    return {
      ok: false,
      error: "That page could not be fetched because the network request failed.",
    };
  }

  return {
    ok: false,
    error: `That page redirected more than ${FETCH_MAX_REDIRECTS} times, so the fetch was stopped.`,
  };
}
