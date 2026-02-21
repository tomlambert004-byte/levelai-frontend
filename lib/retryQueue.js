/**
 * Redis-Backed Retry Queue for Failed Verifications
 *
 * When a Stedi verification fails due to outage, the patient data is
 * encrypted and queued for automatic retry via a cron job.
 *
 * Queue key: "retry:verify:{practiceId}" (Redis list)
 * Each entry is encrypted JSON containing patient data + retry metadata.
 *
 * Retry schedule (exponential backoff):
 *   Attempt 1: immediate + 5 minute delay
 *   Attempt 2: 15 minute delay
 *   Attempt 3: 45 minute delay (final attempt)
 *
 * After 3 failed attempts: moved to "retry:failed:{practiceId}" for admin review.
 * All entries have 24-hour TTL for automatic PHI purge.
 */

import { encrypt, decrypt, isEncryptionConfigured } from "./encryption.js";
import { randomUUID } from "crypto";

const MAX_ATTEMPTS = 3;
const RETRY_TTL_SECONDS = 86400; // 24 hours
const BACKOFF_MINUTES = [5, 15, 45]; // Exponential backoff per attempt

// ── Redis client (lazy-initialized) ──────────────────────────────────────────
let _redis = null;

function getRedis() {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  try {
    const { Redis } = require("@upstash/redis");
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

function queueKey(practiceId) {
  return `retry:verify:${practiceId}`;
}

function failedKey(practiceId) {
  return `retry:failed:${practiceId}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a failed verification for retry.
 *
 * @param {string} practiceId
 * @param {Object} patientData - Patient info needed for re-verification
 * @param {string} error - Error message from the failed attempt
 * @returns {Promise<{ queued: boolean, retryId: string|null }>}
 */
export async function enqueueRetry(practiceId, patientData, error) {
  const redis = getRedis();
  if (!redis || !isEncryptionConfigured()) {
    return { queued: false, retryId: null };
  }

  try {
    const retryId = randomUUID();
    const now = new Date();
    const nextRetryAt = new Date(now.getTime() + BACKOFF_MINUTES[0] * 60_000);

    const entry = {
      retryId,
      patient: patientData,
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextRetryAt: nextRetryAt.toISOString(),
      createdAt: now.toISOString(),
      lastError: error,
    };

    const encrypted = encrypt(JSON.stringify(entry));
    const key = queueKey(practiceId);

    await redis.rpush(key, encrypted);
    await redis.expire(key, RETRY_TTL_SECONDS);

    console.log(`[retryQueue] Enqueued retry ${retryId} for practice ${practiceId}`);
    return { queued: true, retryId };
  } catch (err) {
    console.warn("[retryQueue] enqueueRetry error:", err.message);
    return { queued: false, retryId: null };
  }
}

/**
 * Dequeue entries that are ready for retry (nextRetryAt <= now).
 *
 * @param {number} limit - Max entries to process
 * @returns {Promise<Array<{ practiceId: string, entry: Object, index: number }>>}
 */
export async function dequeueRetries(limit = 10) {
  const redis = getRedis();
  if (!redis || !isEncryptionConfigured()) return [];

  try {
    // Scan all retry:verify:* keys
    const keys = [];
    let cursor = 0;
    do {
      const [newCursor, foundKeys] = await redis.scan(cursor, { match: "retry:verify:*", count: 100 });
      cursor = typeof newCursor === "string" ? parseInt(newCursor) : newCursor;
      keys.push(...foundKeys);
    } while (cursor !== 0);

    const now = new Date();
    const ready = [];

    for (const key of keys) {
      const practiceId = key.replace("retry:verify:", "");
      const items = await redis.lrange(key, 0, -1);

      for (let i = 0; i < items.length && ready.length < limit; i++) {
        try {
          const entry = JSON.parse(decrypt(items[i]));
          if (new Date(entry.nextRetryAt) <= now) {
            ready.push({ practiceId, entry, rawIndex: i, rawValue: items[i] });
          }
        } catch {
          // Skip corrupted entries
          continue;
        }
      }
    }

    return ready;
  } catch (err) {
    console.warn("[retryQueue] dequeueRetries error:", err.message);
    return [];
  }
}

/**
 * Mark a retry as complete (remove from queue).
 *
 * @param {string} practiceId
 * @param {string} rawValue - The raw encrypted value to remove
 */
export async function markRetryComplete(practiceId, rawValue) {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.lrem(queueKey(practiceId), 1, rawValue);
    console.log(`[retryQueue] Retry completed for practice ${practiceId}`);
  } catch (err) {
    console.warn("[retryQueue] markRetryComplete error:", err.message);
  }
}

/**
 * Re-enqueue a retry with incremented attempt count and later nextRetryAt.
 * If max attempts reached, move to failed queue.
 *
 * @param {string} practiceId
 * @param {Object} entry - The retry entry
 * @param {string} rawValue - The raw encrypted value to replace
 * @param {string} error - Error message from the latest failure
 */
export async function reEnqueueOrFail(practiceId, entry, rawValue, error) {
  const redis = getRedis();
  if (!redis || !isEncryptionConfigured()) return;

  try {
    // Remove the old entry
    await redis.lrem(queueKey(practiceId), 1, rawValue);

    const nextAttempt = entry.attempt + 1;

    if (nextAttempt >= MAX_ATTEMPTS) {
      // Max attempts reached — move to failed queue
      const failedEntry = {
        ...entry,
        attempt: nextAttempt,
        lastError: error,
        failedAt: new Date().toISOString(),
        status: "manual_review_required",
      };

      const encrypted = encrypt(JSON.stringify(failedEntry));
      const fKey = failedKey(practiceId);
      await redis.rpush(fKey, encrypted);
      await redis.expire(fKey, RETRY_TTL_SECONDS);

      console.warn(`[retryQueue] Retry ${entry.retryId} exhausted (${MAX_ATTEMPTS} attempts) — moved to failed queue`);
      return;
    }

    // Re-enqueue with later nextRetryAt
    const backoffMs = BACKOFF_MINUTES[nextAttempt] * 60_000;
    const updatedEntry = {
      ...entry,
      attempt: nextAttempt,
      nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
      lastError: error,
    };

    const encrypted = encrypt(JSON.stringify(updatedEntry));
    const key = queueKey(practiceId);
    await redis.rpush(key, encrypted);
    await redis.expire(key, RETRY_TTL_SECONDS);

    console.log(`[retryQueue] Re-enqueued retry ${entry.retryId} — attempt ${nextAttempt + 1}/${MAX_ATTEMPTS}`);
  } catch (err) {
    console.warn("[retryQueue] reEnqueueOrFail error:", err.message);
  }
}

/**
 * Get retry queue status for a practice (count of pending + failed).
 *
 * @param {string} practiceId
 * @returns {Promise<{ pending: number, failed: number }>}
 */
export async function getRetryStatus(practiceId) {
  const redis = getRedis();
  if (!redis) return { pending: 0, failed: 0 };

  try {
    const [pending, failed] = await Promise.all([
      redis.llen(queueKey(practiceId)),
      redis.llen(failedKey(practiceId)),
    ]);
    return { pending: pending || 0, failed: failed || 0 };
  } catch {
    return { pending: 0, failed: 0 };
  }
}
