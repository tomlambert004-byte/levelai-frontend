/**
 * GET /api/v1/retry/process
 *
 * Cron handler — processes the verification retry queue.
 * Triggered every 5 minutes by Vercel Cron.
 *
 * Security: Validates CRON_SECRET header to prevent unauthorized access.
 *
 * Flow:
 *   1. Dequeue up to 10 retries that are due (nextRetryAt <= now)
 *   2. Re-attempt Stedi verification for each
 *   3. On success: remove from queue
 *   4. On failure: re-enqueue with incremented attempt or mark as failed
 */

import { dequeueRetries, markRetryComplete, reEnqueueOrFail } from "../../../../../lib/retryQueue.js";

export async function GET(request) {
  // ── Auth: validate cron secret ────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[retry/process] CRON_SECRET not configured in production");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  try {
    const retries = await dequeueRetries(10);

    if (retries.length === 0) {
      return Response.json({ processed: 0, succeeded: 0, failed: 0, requeued: 0 });
    }

    let succeeded = 0;
    let failed = 0;
    let requeued = 0;

    // Lazy-load stediVerify to avoid circular imports
    let stediVerify;
    try {
      const stediMod = await import("../../../../../lib/stedi.js");
      stediVerify = stediMod.stediVerify;
    } catch {
      console.error("[retry/process] Could not load stedi.js");
      return Response.json({ error: "Stedi module unavailable" }, { status: 500 });
    }

    for (const { practiceId, entry, rawValue } of retries) {
      const patient = entry.patient;

      try {
        // Attempt re-verification
        const result = await stediVerify({
          memberId: patient.memberId,
          firstName: patient.firstName || patient.name?.split(" ")[0] || "",
          lastName: patient.lastName || patient.name?.split(" ").slice(1).join(" ") || "",
          dateOfBirth: patient.dob || patient.dateOfBirth || "",
          payerId: patient.payerId || "",
        });

        // Success — remove from queue
        await markRetryComplete(practiceId, rawValue);
        succeeded++;

        console.log(`[retry/process] Retry ${entry.retryId} succeeded for practice ${practiceId}`);
      } catch (err) {
        // Failure — re-enqueue or mark as permanently failed
        await reEnqueueOrFail(practiceId, entry, rawValue, err.message);

        if (entry.attempt + 1 >= entry.maxAttempts) {
          failed++;
        } else {
          requeued++;
        }
      }
    }

    const summary = {
      processed: retries.length,
      succeeded,
      failed,
      requeued,
      timestamp: new Date().toISOString(),
    };

    console.log(`[retry/process] Completed:`, summary);
    return Response.json(summary);
  } catch (err) {
    console.error("[retry/process] Error:", err.message);
    return Response.json({ error: "Retry processing failed" }, { status: 500 });
  }
}
