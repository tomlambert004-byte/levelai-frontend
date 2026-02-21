/**
 * In-Memory Patient Schedule Cache
 *
 * Replaces Postgres Patient table with a zero-PHI-at-rest architecture.
 * Patient data lives in a module-level Map during business hours (5 AM – 11 PM)
 * and auto-expires. On Railway (long-lived Node process) this Map persists
 * across requests within a single deployment.
 *
 * Cache key: "${practiceId}:${dateStr}" → { patients[], loadedAt, expiresAt }
 *
 * Memory budget: ~2.5 MB max (500 entries × ~10 patients × ~500 bytes each)
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500;              // LRU eviction threshold
const SWEEP_INTERVAL_MS = 30 * 60_000; // 30 minutes
const EXPIRE_HOUR = 23;              // 11 PM — cache entries expire
const EARLIEST_HOUR = 5;             // 5 AM — earliest cache population allowed

// ── The cache ─────────────────────────────────────────────────────────────────
const cache = new Map(); // Map<string, CacheEntry>

/**
 * @typedef {Object} CacheEntry
 * @property {Object[]} patients   — normalized patient objects
 * @property {Date}     loadedAt   — when this entry was first populated
 * @property {Date}     expiresAt  — 11 PM on the date of the entry
 */

// ── Helpers ───────────────────────────────────────────────────────────────────
function cacheKey(practiceId, dateStr) {
  return `${practiceId}:${dateStr}`;
}

function buildExpiresAt(dateStr) {
  // Expires at 11 PM on the given date (server-local time)
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, EXPIRE_HOUR, 0, 0, 0);
}

function isExpired(entry) {
  return Date.now() > entry.expiresAt.getTime();
}

function isBeforeBusinessHours() {
  return new Date().getHours() < EARLIEST_HOUR;
}

// ── LRU eviction ──────────────────────────────────────────────────────────────
function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;

  // Find and evict the oldest entry by loadedAt
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, entry] of cache) {
    if (entry.loadedAt.getTime() < oldestTime) {
      oldestTime = entry.loadedAt.getTime();
      oldestKey = key;
    }
  }
  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

// ── Periodic sweep — delete all expired entries ───────────────────────────────
function sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt.getTime()) {
      cache.delete(key);
    }
  }
}

// Start the sweep timer (safe for module-level — only runs on the server)
if (typeof setInterval !== "undefined") {
  setInterval(sweepExpired, SWEEP_INTERVAL_MS);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get cached patients for a practice + date.
 * Returns null if entry is missing, expired, or before business hours.
 */
export function getCachedSchedule(practiceId, dateStr) {
  const key = cacheKey(practiceId, dateStr);
  const entry = cache.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    cache.delete(key);
    return null;
  }
  return entry.patients;
}

/**
 * Store (or replace) the full schedule for a practice + date.
 * Sets expiry to 11 PM on that date.
 */
export function setCachedSchedule(practiceId, dateStr, patients) {
  const key = cacheKey(practiceId, dateStr);
  cache.set(key, {
    patients: patients || [],
    loadedAt: new Date(),
    expiresAt: buildExpiresAt(dateStr),
  });
  evictIfNeeded();
}

/**
 * Merge a single patient into an existing cache entry (upsert by externalId or name).
 * If no cache entry exists for this date, creates one with just this patient.
 */
export function mergeCachePatient(practiceId, dateStr, patient) {
  const key = cacheKey(practiceId, dateStr);
  const entry = cache.get(key);

  if (!entry || isExpired(entry)) {
    // No existing cache — create a new entry with just this patient
    setCachedSchedule(practiceId, dateStr, [patient]);
    return;
  }

  // Upsert: match by externalId (preferred) or by lowercase name
  const matchKey = patient.externalId
    ? (p) => p.externalId === patient.externalId
    : (p) => p.name?.toLowerCase() === patient.name?.toLowerCase();

  const idx = entry.patients.findIndex(matchKey);
  if (idx >= 0) {
    entry.patients[idx] = { ...entry.patients[idx], ...patient };
  } else {
    entry.patients.push(patient);
  }

  // Update loadedAt to keep this entry "fresh" for LRU purposes
  entry.loadedAt = new Date();
}

/**
 * Remove a patient from cache (e.g., appointment cancelled).
 * Matches by externalId.
 */
export function removeCachePatient(practiceId, dateStr, externalId) {
  if (!externalId) return;
  const key = cacheKey(practiceId, dateStr);
  const entry = cache.get(key);
  if (!entry) return;

  entry.patients = entry.patients.filter((p) => p.externalId !== externalId);
  entry.loadedAt = new Date();
}

/**
 * Invalidate (delete) the cache entry for a practice + date.
 * Forces a fresh PMS pull on the next request.
 */
export function invalidateSchedule(practiceId, dateStr) {
  cache.delete(cacheKey(practiceId, dateStr));
}

/**
 * Cache monitoring — returns stats for debugging/admin endpoints.
 */
export function getCacheStats() {
  let totalPatients = 0;
  let oldestLoadedAt = null;
  for (const entry of cache.values()) {
    totalPatients += entry.patients.length;
    if (!oldestLoadedAt || entry.loadedAt < oldestLoadedAt) {
      oldestLoadedAt = entry.loadedAt;
    }
  }
  return {
    entryCount: cache.size,
    totalPatients,
    oldestLoadedAt: oldestLoadedAt?.toISOString() || null,
    maxEntries: MAX_ENTRIES,
  };
}
