import { base64UrlToBytes, bytesToBase64Url } from "../platform/crypto/encoding.js";

const KEY_VERSION = "v1";

export async function encryptMfaSecret(env, userId, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(userId) },
    await encryptionKey(env),
    new TextEncoder().encode(secret)
  );
  return `${KEY_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptMfaSecret(env, userId, value) {
  const [version, encodedIv, encodedCiphertext, extra] = String(value ?? "").split(".");
  if (version !== KEY_VERSION || !encodedIv || !encodedCiphertext || extra) {
    throw new Error("Invalid MFA secret envelope.");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(encodedIv),
      additionalData: associatedData(userId)
    },
    await encryptionKey(env),
    base64UrlToBytes(encodedCiphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export async function digestRecoveryCode(env, userId, code) {
  const secret = String(env.AUTH_HMAC_SECRET || env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("AUTH_HMAC_SECRET or SESSION_SECRET must be at least 32 characters.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const normalized = normalizeRecoveryCode(code);
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`mfa:recovery\0${Number(userId)}\0${normalized}`)
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(9)))
      .replace(/[-_]/g, "")
      .toUpperCase()
      .padEnd(12, "A")
      .slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function normalizeRecoveryCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function encryptionKey(env) {
  const encoded = String(env.MFA_ENCRYPTION_KEY_V1 || "");
  const bytes = base64UrlToBytes(encoded);
  if (bytes.byteLength !== 32) throw new Error("MFA_ENCRYPTION_KEY_V1 must be a base64url-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function associatedData(userId) {
  return new TextEncoder().encode(`hanlim:mfa:${KEY_VERSION}:${Number(userId)}`);
}
