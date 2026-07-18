import { describe, expect, it } from "vitest";
import {
  decryptCredential,
  encryptCredential,
} from "~/lib/credential-crypto.server";

const credentialKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const otherCredentialKey = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(8)),
);
const plaintext = "sk-or-v1-test-credential";

describe("credential encryption", () => {
  it("round-trips AES-GCM ciphertext without exposing the encryption key", async () => {
    const encrypted = await encryptCredential(plaintext, credentialKey, 1, "club-a");

    await expect(
      decryptCredential(
        { ...encrypted, clubId: "club-a" },
        { OPENROUTER_CREDENTIAL_KEY_V1: credentialKey },
      ),
    ).resolves.toBe(plaintext);
    expect(encrypted).toEqual({
      ciphertext: expect.any(String),
      iv: expect.any(String),
      keyVersion: 1,
    });
    expect(Object.values(encrypted)).not.toContain(credentialKey);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
  });

  it("rejects a different encryption key or version", async () => {
    const encrypted = await encryptCredential(plaintext, credentialKey, 1, "club-a");

    await expect(
      decryptCredential(
        { ...encrypted, clubId: "club-a" },
        { OPENROUTER_CREDENTIAL_KEY_V1: otherCredentialKey },
      ),
    ).rejects.toThrow(/decrypt credential/i);
    await expect(
      decryptCredential(
        { ...encrypted, clubId: "club-a", keyVersion: 2 },
        { OPENROUTER_CREDENTIAL_KEY_V1: credentialKey },
      ),
    ).rejects.toThrow(/version/i);
  });

  it("uses a new IV for each encryption and binds ciphertext to its club", async () => {
    const first = await encryptCredential(plaintext, credentialKey, 1, "club-a");
    const second = await encryptCredential(plaintext, credentialKey, 1, "club-a");

    expect(first.iv).not.toBe(second.iv);
    await expect(
      decryptCredential(
        { ...first, clubId: "club-b" },
        { OPENROUTER_CREDENTIAL_KEY_V1: credentialKey },
      ),
    ).rejects.toThrow(/decrypt credential/i);
  });
});
