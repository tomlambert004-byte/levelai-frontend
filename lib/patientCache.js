/**
 * Encrypted Redis Patient Schedule Cache (Upstash)
 *
 * Zero-PHI-at-rest architecture: patient data is encrypted with AES-256-GCM
 * before storage in Redis, with automatic TTL expiry (11 PM daily or 24h max).
 *
 * Replaces the previous in-memory Map implementation that was ephemeral
 * in serverless environments. This version shares state across all
 * serverless function instances via Upstash Redis (REST-based).
 *
 * Graceful fallback: if UPSTASH_REDIS_REST_URL is not configured,
 * all functions no-op (return null / do nothing). Routes will fall
 * through to PMS or fixture data as before.
 *
 * Cache key: "schedule:{practiceId}:{dateStr}"
 *
 * Public API (unchanged from previous in-memory version):
 *   getCachedSchedule(practiceId, dateStr) → patients[] | null
 *   setCachedSchedule(practiceId, dateStr, patients) → void
 *   mergeCachePatient(practiceId, dateStr, patient) → void
 *   removeCachePatient(practiceId, dateStr, externalId) → void
 *   invalidateSchedule(practiceId, dateStr) → void
 *   getCacheStats() → { provider, entryCount, totalPatients, ... }
 */

import { encrypt, decrypt, isEncryptionConfigured } from "./encryption.js";

// ── Configuration ─────────────────────────────────────────────────────────────
const EXPIRE_HOUR = 23;   // 11 PM — cache entries expire
const EARLIEST_HOUR = 5;  // 5 AM — earliest cache population allowed
const MAX_TTL_SECONDS = 86400; // 24-hour hard cap on TTL

// ── Redis client (lazy-initialized) ──────────────────────────────────────────
let _redis = null;

function getRedis() {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  try {
    // Dynamic require to avoid build-time errors when package isn't installed
    const { Redis } = require("@upstash/redis");
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    console.warn("[patientCache] Failed to initialize Upstash Redis:", err.message);
    return null;
  }
}

/**
 * Check if Redis cache is available (URL + token + encryption key all set).
 */
function isCacheAvailable() {
  return getRedis() !== null && isEncryptionConfigured();
}

// ── Module-level stats (reset on cold start) ─────────────────────────────────
let hits = 0;
let misses = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function redisKey(practiceId, dateStr) {
  return `schedule:${practiceId}:${dateStr}`;
}

/**
 * Calculate TTL in seconds: expires at 11 PM on the given date,
 * capped at 24 hours.
 */
function calculateTTL(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const expiresAt = new Date(year, month - 1, day, EXPIRE_HOUR, 0, 0, 0);
  const secondsUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

  // If the expiry time is in the past (late night), use a short TTL
  if (secondsUntilExpiry <= 0) return 60; // 1 minute (stale entry cleanup)

  // Cap at 24 hours
  return Math.min(secondsUntilExpiry, MAX_TTL_SECONDS);
}

function isBeforeBusinessHours() {
  return new Date().getHours() < EARLIEST_HOUR;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get cached patients for a practice + date.
 * Returns null if entry is missing, expired, or Redis is unavailable.
 */
export async function getCachedSchedule(practiceId, dateStr) {
  if (!isCacheAvailable()) {
    misses++;
    return null;
  }

  try {
    const redis = getRedis();
    const key = redisKey(practiceId, dateStr);
    const encrypted = await redis.get(key);

    if (!encrypted) {
      misses++;
      return null;
    }

    const json = decrypt(encrypted);
    const patients = JSON.parse(json);
    hits++;
    return patients;
  } catch (err) {
    console.warn("[patientCache] getCachedSchedule error:", err.message);
    misses++;
    return null;
  }
}

/**
 * Store (or replace) the full schedule for a practice + date.
 * Sets TTL to expire at 11 PM on that date (max 24h).
 */
export async function setCachedSchedule(practiceId, dateStr, patients) {
  if (!isCacheAvailable()) return;
  if (isBeforeBusinessHours()) return; // Don't populate cache before 5 AM

  try {
    const redis = getRedis();
    const key = redisKey(practiceId, dateStr);
    const json = JSON.stringify(patients || []);
    const encrypted = encrypt(json);
    const ttl = calculateTTL(dateStr);

    await redis.set(key, encrypted, { ex: ttl });
  } catch (err) {
    console.warn("[patientCache] setCachedSchedule error:", err.message);
    // Fail silently — route will still return data from PMS/fixture
  }
}

/**
 * Merge a single patient into an existing cache entry (upsert by externalId or name).
 * If no cache entry exists for this date, creates one with just this patient.
 */
export async function mergeCachePatient(practiceId, dateStr, patient) {
  if (!isCacheAvailable()) return;

  try {
    const existing = await getCachedSchedule(practiceId, dateStr);

    if (!existing) {
      // No existing cache — create a new entry with just this patient
      await setCachedSchedule(practiceId, dateStr, [patient]);
      return;
    }

    // Upsert: match by externalId (preferred) or by lowercase name
    const matchKey = patient.externalId
      ? (p) => p.externalId === patient.externalId
      : (p) => p.name?.toLowerCase() === patient.name?.toLowerCase();

    const idx = existing.findIndex(matchKey);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...patient };
    } else {
      existing.push(patient);
    }

    await setCachedSchedule(practiceId, dateStr, existing);
  } catch (err) {
    console.warn("[patientCache] mergeCachePatient error:", err.message);
  }
}

/**
 * Remove a patient from cache (e.g., appointment cancelled).
 * Matches by externalId.
 */
export async function removeCachePatient(practiceId, dateStr, externalId) {
  if (!externalId || !isCacheAvailable()) return;

  try {
    const existing = await getCachedSchedule(practiceId, dateStr);
    if (!existing) return;

    const filtered = existing.filter((p) => p.externalId !== externalId);
    await setCachedSchedule(practiceId, dateStr, filtered);
  } catch (err) {
    console.warn("[patientCache] removeCachePatient error:", err.message);
  }
}

/**
 * Invalidate (delete) the cache entry for a practice + date.
 * Forces a fresh PMS pull on the next request.
 */
export async function invalidateSchedule(practiceId, dateStr) {
  if (!isCacheAvailable()) return;

  try {
    const redis = getRedis();
    await redis.del(redisKey(practiceId, dateStr));
  } catch (err) {
    console.warn("[patientCache] invalidateSchedule error:", err.message);
  }
}

/**
 * Cache monitoring — returns stats for debugging/admin endpoints.
 */
export function getCacheStats() {
  return {
    provider: isCacheAvailable() ? "upstash-redis" : "none (not configured)",
    hits,
    misses,
    hitRate: hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(1) + "%" : "N/A",
    encrypted: isEncryptionConfigured(),
  };
}
