export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export type StoredEncryptedCredential = EncryptedCredential & {
  clubId: string;
};

type CredentialCryptoEnv = {
  OPENROUTER_CREDENTIAL_KEY_V1?: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Credential encryption key is not valid base64.");
  }
}

async function importAesKey(encodedKey: string): Promise<CryptoKey> {
  const rawKey = decodeBase64(encodedKey);
  if (rawKey.byteLength !== 32) {
    throw new Error("Credential encryption key must be 32 bytes.");
  }
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function additionalData(clubId: string, keyVersion: number): Uint8Array {
  return encoder.encode(`${clubId}:${keyVersion}`);
}

function keyForVersion(env: CredentialCryptoEnv, keyVersion: number): string {
  if (keyVersion !== 1) {
    throw new Error(`Unsupported credential key version: ${keyVersion}.`);
  }
  if (!env.OPENROUTER_CREDENTIAL_KEY_V1) {
    throw new Error("OPENROUTER_CREDENTIAL_KEY_V1 is not set.");
  }
  return env.OPENROUTER_CREDENTIAL_KEY_V1;
}

/**
 * Encrypts a provider credential for one club. The caller owns plaintext only
 * long enough to store this record; the encryption key is never retained.
 */
export async function encryptCredential(
  plaintext: string,
  encodedKey: string,
  keyVersion: number,
  clubId: string,
): Promise<EncryptedCredential> {
  if (keyVersion !== 1) {
    throw new Error(`Unsupported credential key version: ${keyVersion}.`);
  }
  const key = await importAesKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(clubId, keyVersion),
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
    keyVersion,
  };
}

/** Decrypts an encrypted credential only for server-side provider use. */
export async function decryptCredential(
  record: StoredEncryptedCredential,
  env: CredentialCryptoEnv,
): Promise<string> {
  const encodedKey = keyForVersion(env, record.keyVersion);
  try {
    const key = await importAesKey(encodedKey);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(record.iv),
        additionalData: additionalData(record.clubId, record.keyVersion),
      },
      key,
      decodeBase64(record.ciphertext),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("Unable to decrypt credential.");
  }
}
