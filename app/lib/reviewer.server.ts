const encoder = new TextEncoder();

/**
 * Stable UUIDv5-shaped IDs keep reviewer login and seeded sample data attached
 * to the same account without relying on mutable email lookups.
 */
export async function reviewerEntityId(email: string, entity: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`review:${email.trim().toLowerCase()}:${entity}`),
  ));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function reviewerUserId(email: string) {
  return reviewerEntityId(email, "user");
}
