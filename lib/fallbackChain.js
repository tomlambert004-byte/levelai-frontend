/**
 * Fallback Chain — wraps third-party API calls with structured error handling
 *
 * Instead of throwing on failure, returns a structured { status: "system_outage" }
 * response that the frontend can handle gracefully.
 *
 * Integrates with:
 * - outageDetector.js: records success/failure for circuit breaker
 * - retryQueue.js: optionally enqueues failed operations for later retry
 *
 * Usage:
 *   const result = await withFallback(
 *     () => stediVerify(params),           // primary function
 *     [],                                   // fallbacks (future: secondary clearinghouse)
 *     { service: "stedi", practiceId, patientData, enqueueRetry: true }
 *   );
 */

import { recordSuccess, recordFailure, getServiceStatus } from "./outageDetector.js";

/**
 * Execute a primary function with optional fallbacks and structured error handling.
 *
 * @param {Function} primaryFn - Async function to try first
 * @param {Array<{ name: string, fn: Function }>} fallbacks - Ordered fallback functions
 * @param {Object} context - Metadata for error reporting and retry
 * @param {string} context.service - Service name ("stedi" | "anthropic" | "opendental")
 * @param {string} [context.practiceId] - Practice ID for retry queue
 * @param {Object} [context.patientData] - Patient data for retry queue
 * @param {boolean} [context.enqueueRetry=false] - Whether to queue for retry on failure
 * @returns {Promise<Object>} - Either the successful result or a system_outage object
 */
export async function withFallback(primaryFn, fallbacks = [], context = {}) {
  const { service, enqueueRetry = false } = context;

  // ── Check if service is already known to be degraded ─────────────────────
  if (service) {
    const status = await getServiceStatus(service);
    if (status.status === "degraded") {
      // Service is known-degraded — skip the primary call to avoid piling up
      // timeouts. Go straight to fallbacks or outage response.
      console.warn(`[fallbackChain] Service "${service}" is degraded — skipping primary call`);

      // Try fallbacks
      for (const fallback of fallbacks) {
        try {
          const result = await fallback.fn();
          return { ...result, _fallback: fallback.name, _serviceDegraded: service };
        } catch {
          continue;
        }
      }

      // Queue for retry if requested
      let retryQueued = false;
      if (enqueueRetry && context.practiceId && context.patientData) {
        try {
          const { enqueueRetry: enqueue } = await import("./retryQueue.js");
          await enqueue(context.practiceId, context.patientData, `${service} is degraded`);
          retryQueued = true;
        } catch (retryErr) {
          console.warn("[fallbackChain] Failed to enqueue retry:", retryErr.message);
        }
      }

      return {
        status: "system_outage",
        service,
        retryQueued,
        degradedSince: status.degradedSince,
        message: `${formatServiceName(service)} is temporarily unavailable.${retryQueued ? " Verification has been queued for automatic retry." : " Please try again later."}`,
      };
    }
  }

  // ── Try primary function ────────────────────────────────────────────────
  try {
    const result = await primaryFn();

    // Record success to reset failure counter
    if (service) {
      await recordSuccess(service).catch(() => {}); // Fire-and-forget
    }

    return result;
  } catch (primaryError) {
    console.warn(`[fallbackChain] Primary "${service || "unknown"}" failed:`, primaryError.message);

    // Record failure for circuit breaker
    if (service) {
      await recordFailure(service).catch(() => {}); // Fire-and-forget
    }

    // ── Try fallbacks ───────────────────────────────────────────────────
    for (const fallback of fallbacks) {
      try {
        const result = await fallback.fn();
        return { ...result, _fallback: fallback.name };
      } catch (fallbackError) {
        console.warn(`[fallbackChain] Fallback "${fallback.name}" also failed:`, fallbackError.message);
        continue;
      }
    }

    // ── All fallbacks exhausted — return structured outage response ────
    let retryQueued = false;
    if (enqueueRetry && context.practiceId && context.patientData) {
      try {
        const { enqueueRetry: enqueue } = await import("./retryQueue.js");
        await enqueue(context.practiceId, context.patientData, primaryError.message);
        retryQueued = true;
      } catch (retryErr) {
        console.warn("[fallbackChain] Failed to enqueue retry:", retryErr.message);
      }
    }

    return {
      status: "system_outage",
      service: service || "unknown",
      retryQueued,
      message: `${formatServiceName(service)} is temporarily unavailable.${retryQueued ? " Verification has been queued for automatic retry." : " Please try again later."}`,
      error: primaryError.message,
    };
  }
}

/**
 * Format service name for user-facing messages.
 */
function formatServiceName(service) {
  const names = {
    stedi: "Insurance verification service",
    anthropic: "AI assistant",
    opendental: "Practice management system",
  };
  return names[service] || "External service";
}
