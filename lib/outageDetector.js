/**
 * Outage Detector — Redis-backed circuit breaker for third-party services
 *
 * Tracks consecutive failures per service (stedi, anthropic, opendental).
 * After N consecutive failures, marks service as "degraded".
 * Auto-recovers: Redis keys have 1-hour TTL, so stale outage data expires.
 *
 * Graceful fallback: if Redis is unavailable, always returns "healthy".
 *
 * Supported services: "stedi", "anthropic", "opendental"
 */

const FAILURE_THRESHOLD = 3; // Consecutive failures before "degraded"
const OUTAGE_TTL_SECONDS = 3600; // 1 hour — auto-recover if no requests

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

// ── Redis key helpers ────────────────────────────────────────────────────────
function failureKey(service) {
  return `outage:${service}:failures`;
}

function lastFailureKey(service) {
  return `outage:${service}:lastFailure`;
}

function degradedSinceKey(service) {
  return `outage:${service}:degradedSince`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a successful API call — resets the failure counter.
 * @param {string} service - "stedi" | "anthropic" | "opendental"
 */
export async function recordSuccess(service) {
  const redis = getRedis();
  if (!redis) return;

  try {
    // Reset all outage keys for this service
    await redis.del(failureKey(service));
    await redis.del(lastFailureKey(service));
    await redis.del(degradedSinceKey(service));
  } catch (err) {
    console.warn(`[outageDetector] recordSuccess error for ${service}:`, err.message);
  }
}

/**
 * Record a failed API call — increments failure counter.
 * Marks service as "degraded" after FAILURE_THRESHOLD consecutive failures.
 * @param {string} service - "stedi" | "anthropic" | "opendental"
 */
export async function recordFailure(service) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const now = new Date().toISOString();

    // Increment consecutive failure count
    const count = await redis.incr(failureKey(service));

    // Set TTL on first failure (auto-expire after 1 hour of no activity)
    if (count === 1) {
      await redis.expire(failureKey(service), OUTAGE_TTL_SECONDS);
    }

    // Record last failure timestamp
    await redis.set(lastFailureKey(service), now, { ex: OUTAGE_TTL_SECONDS });

    // Mark as degraded if threshold reached
    if (count >= FAILURE_THRESHOLD) {
      // Only set degradedSince on the first crossing of the threshold
      const existing = await redis.get(degradedSinceKey(service));
      if (!existing) {
        await redis.set(degradedSinceKey(service), now, { ex: OUTAGE_TTL_SECONDS });
        console.warn(`[outageDetector] Service "${service}" marked DEGRADED after ${count} consecutive failures`);
      }
    }
  } catch (err) {
    console.warn(`[outageDetector] recordFailure error for ${service}:`, err.message);
  }
}

/**
 * Get the current health status of a service.
 * @param {string} service - "stedi" | "anthropic" | "opendental"
 * @returns {Promise<{ status: 'healthy'|'degraded', consecutiveFailures: number, lastFailureAt: string|null, degradedSince: string|null }>}
 */
export async function getServiceStatus(service) {
  const redis = getRedis();

  if (!redis) {
    return { status: "healthy", consecutiveFailures: 0, lastFailureAt: null, degradedSince: null };
  }

  try {
    const [failures, lastFailure, degradedSince] = await Promise.all([
      redis.get(failureKey(service)),
      redis.get(lastFailureKey(service)),
      redis.get(degradedSinceKey(service)),
    ]);

    const consecutiveFailures = parseInt(failures) || 0;
    const isDegraded = consecutiveFailures >= FAILURE_THRESHOLD;

    return {
      status: isDegraded ? "degraded" : "healthy",
      consecutiveFailures,
      lastFailureAt: lastFailure || null,
      degradedSince: degradedSince || null,
    };
  } catch (err) {
    console.warn(`[outageDetector] getServiceStatus error for ${service}:`, err.message);
    return { status: "healthy", consecutiveFailures: 0, lastFailureAt: null, degradedSince: null };
  }
}

/**
 * Get health status for all monitored services.
 * @returns {Promise<Record<string, { status, consecutiveFailures, lastFailureAt, degradedSince }>>}
 */
export async function getAllServiceStatuses() {
  const services = ["stedi", "anthropic", "opendental"];
  const results = {};

  for (const service of services) {
    results[service] = await getServiceStatus(service);
  }

  return results;
}
