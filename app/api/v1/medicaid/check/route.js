/**
 * POST /api/v1/medicaid/check
 *
 * Runs CDT codes through the state Medicaid dental rule engine.
 * No DB or external API required — all logic is pure config lookups.
 *
 * Request:  { cdt_codes: ["D1110","D2750"], state: "TX", patient_age: 35 }
 * Response: { state, program_name, checks: [{ code, description, covered, ... }] }
 */

import { runMedicaidCheck, getStateRules, getSupportedStates } from "../../../../../lib/medicaidRules.js";
import { getMedicaidProgramName } from "../../../../../lib/medicaidDetect.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";
import { getClientIp } from "../../../../../lib/audit.js";

export async function POST(request) {
  try {
    // Rate limit: 30 req/min per IP
    const ip = getClientIp(request);
    const rl = checkRateLimit(`medicaid:${ip}`, { maxRequests: 30, windowMs: 60_000 });
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

    return Response.json({
      state: state.toUpperCase(),
      program_name: getMedicaidProgramName(state),
      adult_dental_covered: rules.adultDentalCovered,
      ...result,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
