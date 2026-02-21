/**
 * AES-256-GCM Encryption/Decryption for PHI at Rest
 *
 * Used by patientCache.js and retryQueue.js to encrypt patient data
 * before storing in Redis (Upstash). Provides defense-in-depth on
 * top of Upstash's built-in TLS + at-rest encryption.
 *
 * Key: REDIS_ENCRYPTION_KEY env var — 64 hex chars (32 bytes)
 * Format: base64(iv:authTag:ciphertext)
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;     // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Get the encryption key from environment.
 * Returns null if not configured (allows graceful no-op).
 */
function getKey() {
  const hex = process.env.REDIS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing iv + authTag + ciphertext.
 *
 * @param {string} plaintext
 * @returns {string} encrypted base64 string
 * @throws {Error} if REDIS_ENCRYPTION_KEY is not configured
 */
export function encrypt(plaintext) {
  const key = getKey();
  if (!key) {
    throw new Error("[encryption] REDIS_ENCRYPTION_KEY not configured (need 64 hex chars)");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext (N)
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64 string produced by encrypt().
 *
 * @param {string} encryptedBase64
 * @returns {string} plaintext
 * @throws {Error} if decryption fails (tampered data or wrong key)
 */
export function decrypt(encryptedBase64) {
  const key = getKey();
  if (!key) {
    throw new Error("[encryption] REDIS_ENCRYPTION_KEY not configured (need 64 hex chars)");
  }

  const packed = Buffer.from(encryptedBase64, "base64");

  // Unpack: iv (12) + authTag (16) + ciphertext (rest)
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if encryption is available (key is configured).
 * @returns {boolean}
 */
export function isEncryptionConfigured() {
  return getKey() !== null;
}
