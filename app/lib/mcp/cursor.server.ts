import { signValue, verifyValue } from "~/lib/auth.server";
import { McpPublicError } from "~/lib/mcp/errors.server";

type CursorKind = string;
type UpdatedAtPosition = { updatedAt: number; id: string };
type OffsetPosition = { offset: number };

export type CursorPayload = {
  kind: CursorKind;
  position: UpdatedAtPosition | OffsetPosition;
};

type SerializedCursor = CursorPayload & { version: 1 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function invalidCursor(): McpPublicError {
  return new McpPublicError(
    "invalid_cursor",
    "The pagination cursor is invalid or expired.",
  );
}

function encodeBase64Url(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function isPosition(value: unknown): value is UpdatedAtPosition | OffsetPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  if ("updatedAt" in position || "id" in position) {
    return Number.isFinite(position.updatedAt)
      && typeof position.id === "string"
      && position.id.length > 0;
  }
  return Number.isInteger(position.offset)
    && typeof position.offset === "number"
    && position.offset >= 0;
}

function isPayload(value: unknown): value is SerializedCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return cursor.version === 1
    && typeof cursor.kind === "string"
    && cursor.kind.length > 0
    && isPosition(cursor.position);
}

export async function encodeCursor(secret: string, cursor: CursorPayload): Promise<string> {
  const value = encodeBase64Url(JSON.stringify({ version: 1, ...cursor }));
  return signValue(value, secret);
}

export async function decodeCursor(
  secret: string,
  expectedKind: CursorKind,
  value: string,
): Promise<CursorPayload> {
  const signedValue = await verifyValue(value, secret);
  const decodedValue = signedValue ? decodeBase64Url(signedValue) : null;
  if (!decodedValue) throw invalidCursor();

  try {
    const cursor: unknown = JSON.parse(decodedValue);
    if (!isPayload(cursor) || cursor.kind !== expectedKind) throw invalidCursor();
    return { kind: cursor.kind, position: cursor.position };
  } catch (error) {
    if (error instanceof McpPublicError) throw error;
    throw invalidCursor();
  }
}
