/**
 * POST /api/v1/medicaid/check
 *
 * Runs CDT codes through the state Medicaid dental rule engine.
 * No DB or external API required — all logic is pure config lookups.
 *
 * Request:  { cdt_codes: ["D1110","D2750"], state: "TX", patient_age: 35 }
 * Response: { state, program_name, checks: [{ code, description, covered, ... }] }
 */

import { auth } from "@clerk/nextjs/server";
import { runMedicaidCheck, getStateRules, getSupportedStates } from "../../../../../lib/medicaidRules.js";
import { getMedicaidProgramName } from "../../../../../lib/medicaidDetect.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";

export async function POST(request) {
  try {
    // Auth check
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 30 req/min per user (userId, not IP — prevents cross-tenant collisions)
    const ip = getClientIp(request);
    const rl = checkRateLimit(`medicaid:${userId}`, { maxRequests: 30, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const { cdt_codes, state, patient_age } = body;

    if (!state) {
      return Response.json({ error: "state is required (e.g. 'TX')" }, { status: 400 });
    }

    if (!cdt_codes || !Array.isArray(cdt_codes) || cdt_codes.length === 0) {
      return Response.json({ error: "cdt_codes array is required" }, { status: 400 });
    }

    const rules = getStateRules(state);
    if (!rules) {
      return Response.json({
        error: `State "${state}" not supported. Supported: ${getSupportedStates().join(", ")}`,
      }, { status: 400 });
    }

    const result = runMedicaidCheck(state, cdt_codes, patient_age ?? null);

    // Resolve practiceId for audit — don't leave it null
    let practiceId = null;
    try {
      const { prisma } = await import("../../../../../lib/prisma.js");
      const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
      if (practice) practiceId = practice.id;
    } catch { /* non-critical */ }

    logAudit({
      practiceId,
      userId,
      action: "medicaid.check",
      resourceType: "Medicaid",
      ipAddress: ip,
      metadata: { state, cdt_codes },
    });

    return Response.json({
      state: state.toUpperCase(),
      program_name: getMedicaidProgramName(state),
      adult_dental_covered: rules.adultDentalCovered,
      ...result,
    });
  } catch (err) {
    console.error("[medicaid/check] Error:", err.name);
    return Response.json({ error: "Medicaid check failed. Please try again." }, { status: 500 });
  }
}
