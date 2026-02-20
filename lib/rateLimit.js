/**
 * In-Memory Sliding Window Rate Limiter
 *
 * Suitable for single-process deployments (Railway).
 * No external dependencies required.
 */

const windowMap = new Map();

// Auto-prune expired entries every 60s
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

/**
 * @param {string} key - Unique identifier (e.g. "verify:192.168.1.1")
 * @param {{ maxRequests: number, windowMs: number }} opts
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(key, { maxRequests, windowMs }) {
  const now = Date.now();
  const timestamps = windowMap.get(key) || [];

  // Keep only timestamps within the current window
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

/**
 * Returns a 429 Response if rate limit exceeded.
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
