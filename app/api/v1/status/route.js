/**
 * GET /api/v1/status
 *
 * Service health endpoint. Returns status of all external services
 * (Stedi, Anthropic, Open Dental) and retry queue depth.
 *
 * Used by the frontend to display proactive outage banners.
 * No auth required — returns only aggregate health data, no PHI.
 */

import { getAllServiceStatuses } from "../../../../lib/outageDetector.js";
import { getCacheStats } from "../../../../lib/patientCache.js";

export async function GET() {
  try {
    const services = await getAllServiceStatuses();
    const cache = getCacheStats();

    // Check if any service is degraded
    const anyDegraded = Object.values(services).some((s) => s.status === "degraded");

    return Response.json({
      overall: anyDegraded ? "degraded" : "healthy",
      services,
      cache,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[status] Error:", err.message);
    return Response.json({
      overall: "unknown",
      error: "Failed to fetch service statuses",
      timestamp: new Date().toISOString(),
    });
  }
}
