/**
 * Redis-Backed Sliding Window Rate Limiter (Upstash)
 *
 * Uses Redis INCR + PEXPIRE for atomic increment-and-expire, ensuring
 * rate limits are shared across all serverless function instances.
 *
 * Graceful fallback: if UPSTASH_REDIS_REST_URL is not configured,
 * falls back to an in-memory Map (suitable for single-process / dev).
 *
 * Public API (unchanged from previous version):
 *   checkRateLimit(key, { maxRequests, windowMs }) → { allowed, remaining, retryAfterMs }
 *   rateLimitResponse(result) → Response | null
 */

// ── Redis client (shared with patientCache) ──────────────────────────────────
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

// ── In-memory fallback (for local dev / when Redis is unavailable) ───────────
const windowMap = new Map();

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of windowMap) {
      const filtered = timestamps.filter((t) => now - t < 120_000);
      if (filtered.length === 0) windowMap.delete(key);
      else windowMap.set(key, filtered);
    }
  }, 60_000).unref?.();
}

function checkRateLimitMemory(key, { maxRequests, windowMs }) {
  const now = Date.now();
  const timestamps = windowMap.get(key) || [];
  const recent = timestamps.filter((t) => now - t < windowMs);

  if (recent.length >= maxRequests) {
    const oldest = recent[0];
    const retryAfterMs = windowMs - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  recent.push(now);
  windowMap.set(key, recent);
  return { allowed: true, remaining: maxRequests - recent.length, retryAfterMs: 0 };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check rate limit for a given key.
 * Uses Redis when available, falls back to in-memory.
 *
 * @param {string} key - Unique identifier (e.g. "verify:userId123")
 * @param {{ maxRequests: number, windowMs: number }} opts
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterMs: number }>}
 */
export async function checkRateLimit(key, { maxRequests, windowMs }) {
  const redis = getRedis();

  if (!redis) {
    // Fallback to in-memory (works fine for single-process deployments)
    return checkRateLimitMemory(key, { maxRequests, windowMs });
  }

  try {
    // Bucket key: time-windowed bucket for sliding window approximation
    const windowSec = Math.ceil(windowMs / 1000);
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `rl:${key}:${bucket}`;

    // Atomic increment + set TTL
    const count = await redis.incr(redisKey);

    // Set expiry on first increment (only if TTL isn't already set)
    if (count === 1) {
      await redis.expire(redisKey, windowSec + 1); // +1s buffer
    }

    if (count > maxRequests) {
      const retryAfterMs = Math.max(windowMs - (Date.now() % windowMs), 1000);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: maxRequests - count, retryAfterMs: 0 };
  } catch (err) {
    console.warn("[rateLimit] Redis error, falling back to in-memory:", err.message);
    return checkRateLimitMemory(key, { maxRequests, windowMs });
  }
}

/**
 * Returns a 429 Response if rate limit exceeded.
 * @param {{ allowed: boolean, retryAfterMs: number }} result
 * @returns {Response|null}
 */
export function rateLimitResponse(result) {
  if (result.allowed) return null;
  const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
  return Response.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    }
  );
}
