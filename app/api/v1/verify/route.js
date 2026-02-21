/**
 * POST /api/v1/verify
 *
 * Self-contained eligibility verification — no Python backend required.
 * Carries all fixture data and normalization logic inline so it works
 * in any deployment (Railway, Vercel, local) without a sidecar service.
 *
 * Body:  { patient_id: "p1" | "p2" | ... | "p7" }
 * Returns: NormalizedVerificationResult
 */

// ── Fixture data (inline — mirrors backend/fixtures/*.json) ──────────────────
const FIXTURES = {
  p1: {
    _fixture_id: "271_active_clean",
    subscriber: { member_id: "DD00112233", first_name: "Margaret", last_name: "Holloway",
      date_of_birth: "1978-04-22", group_number: "GRP-001122", plan_name: "Delta Dental PPO Plus Premier" },
    payer: { name: "Delta Dental PPO", payer_id: "DELTA_PPO" },
    coverage: { plan_status: "active", plan_begin_date: "2024-01-01", plan_end_date: "2026-12-31",
      insurance_type: "PPO", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: 200000, used_cents: 55000, remaining_cents: 145000 },
      deductible: { individual_cents: 5000, met_cents: 5000, family_cents: 15000, family_met_cents: 10000,
        applies_to: ["basic","major"], waived_for: ["preventive"] },
      preventive: { coverage_pct: 100, deductible_applies: false, copay_cents: null,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 1, period: "calendar_year",
            last_service_date: "2026-08-15", next_eligible_date: null },
          bitewing_xrays: { times_per_period: 1, used_this_period: 0, next_eligible_date: null } } },
      basic_restorative: { coverage_pct: 80, deductible_applies: true, copay_cents: null,
        composite_posterior_downgrade: false },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
  },

  p2: {
    _fixture_id: "271_composite_downgrade_low_max",
    subscriber: { member_id: "CIG98765432", first_name: "Carlos", last_name: "Reyes",
      date_of_birth: "1991-11-03", group_number: "GRP-098765", plan_name: "Cigna Dental 1000" },
    payer: { name: "Cigna Dental", payer_id: "CIGNA" },
    coverage: { plan_status: "active", plan_begin_date: "2026-01-01", plan_end_date: "2026-12-31",
      insurance_type: "PPO", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: 100000, used_cents: 78000, remaining_cents: 22000 },
      deductible: { individual_cents: 5000, met_cents: 5000, waived_for: ["preventive"] },
      preventive: { coverage_pct: 100, deductible_applies: false,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 1, period: "calendar_year",
            next_eligible_date: null } } },
      basic_restorative: { coverage_pct: 80, deductible_applies: true,
        composite_posterior_downgrade: true,
        composite_posterior_downgrade_note: "Posterior composites reimbursed at amalgam rate." },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
  },

  p3: {
    _fixture_id: "271_inactive_plan",
    subscriber: { member_id: "MET44412222", first_name: "Diane", last_name: "Okafor",
      date_of_birth: "1965-07-18", group_number: "GRP-044412", plan_name: "MetLife PDP Plus" },
    payer: { name: "MetLife Dental", payer_id: "METLIFE" },
    coverage: { plan_status: "inactive", termination_reason: "employment_terminated",
      plan_begin_date: "2023-01-01", plan_end_date: "2026-01-31", insurance_type: "PPO", in_network: false },
    benefits: {
      calendar_year_maximum: { amount_cents: 150000, used_cents: 150000, remaining_cents: 0 },
      deductible: { individual_cents: 5000, met_cents: 5000 },
      missing_tooth_clause: { applies: false },
    },
  },

  p4: {
    _fixture_id: "271_missing_tooth_clause",
    subscriber: { member_id: "AET77700011", first_name: "James", last_name: "Whitfield",
      date_of_birth: "2002-01-30", group_number: "GRP-077700", plan_name: "Aetna DMO Essential" },
    payer: { name: "Aetna DMO", payer_id: "AETNA_DMO" },
    coverage: { plan_status: "active", plan_begin_date: "2025-06-01", plan_end_date: "2026-05-31",
      insurance_type: "DMO", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: 200000, used_cents: 100000, remaining_cents: 100000 },
      deductible: { individual_cents: 5000, met_cents: 0, family_cents: 15000, family_met_cents: 0,
        applies_to: ["basic","major"], waived_for: ["preventive"] },
      preventive: { coverage_pct: 100, deductible_applies: false,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 0, period: "calendar_year",
            next_eligible_date: null } } },
      basic_restorative: { coverage_pct: 80, deductible_applies: true },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 12 },
      missing_tooth_clause: {
        applies: true,
        affected_teeth: ["#14"],
        extraction_date_on_file: "2024-03-10",
        excluded_services: [
          "D6010 — Implant body placement",
          "D6056 — Implant supported crown (titanium)",
          "D6057 — Implant supported crown (porcelain fused to titanium)",
          "D6240 — Pontic, porcelain fused to precious metal",
          "D6750 — Crown, porcelain fused to high noble metal",
        ],
        exception_pathway: "Submit pre-authorization with dated extraction records and clinical notes. Carrier review takes 5–7 business days.",
      },
    },
  },

  p5: {
    _fixture_id: "271_active_deductible_not_met",
    subscriber: { member_id: "GRD55566677", first_name: "Susan", last_name: "Nakamura",
      date_of_birth: "1983-09-14", group_number: "GRP-055566", plan_name: "Guardian DentalGuard Preferred" },
    payer: { name: "Guardian Dental", payer_id: "GUARDIAN" },
    coverage: { plan_status: "active", plan_begin_date: "2026-01-01", plan_end_date: "2026-12-31",
      insurance_type: "PPO", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: 200000, used_cents: 55000, remaining_cents: 145000 },
      deductible: { individual_cents: 5000, met_cents: 0, family_cents: 15000, family_met_cents: 0,
        applies_to: ["basic","major","endodontic"], waived_for: ["preventive"] },
      preventive: { coverage_pct: 100, deductible_applies: false,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 0, period: "calendar_year" } } },
      basic_restorative: { coverage_pct: 80, deductible_applies: true, composite_posterior_downgrade: false },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
  },

  p6: {
    _fixture_id: "271_frequency_limit",
    subscriber: { member_id: "DD00998877", first_name: "Derek", last_name: "Fontaine",
      date_of_birth: "1970-03-28", group_number: "GRP-009988", plan_name: "Delta Dental PPO Plus Premier" },
    payer: { name: "Delta Dental PPO", payer_id: "DELTA_PPO" },
    coverage: { plan_status: "active", plan_begin_date: "2025-01-01", plan_end_date: "2026-12-31",
      insurance_type: "PPO", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: 200000, used_cents: 112000, remaining_cents: 88000 },
      deductible: { individual_cents: 5000, met_cents: 5000, family_cents: 15000, family_met_cents: 15000,
        applies_to: ["basic","major"], waived_for: ["preventive"] },
      preventive: { coverage_pct: 100, deductible_applies: false, copay_cents: null,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 2, period: "calendar_year",
            last_service_date: "2026-02-01", next_eligible_date: "2027-01-01" },
          bitewing_xrays: { times_per_period: 1, used_this_period: 1, period: "calendar_year",
            next_eligible_date: "2027-01-01" } } },
      basic_restorative: { coverage_pct: 80, deductible_applies: true, composite_posterior_downgrade: false },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
  },

  // ── p8: Medicaid patient (Texas Medicaid / TMHP) ──────────────────────────────
  p8: {
    _fixture_id: "271_medicaid_tx",
    _is_medicaid: true,
    _medicaid_state: "TX",
    subscriber: { member_id: "TMHP-990-221-08", first_name: "Marvin", last_name: "Medicaid",
      date_of_birth: "1978-08-22", group_number: "TX-MEDICAID", plan_name: "Texas Medicaid (TMHP)" },
    payer: { name: "Texas Medicaid (TMHP)", payer_id: "77037" },
    coverage: { plan_status: "active", plan_begin_date: "2025-01-01", plan_end_date: "2026-12-31",
      insurance_type: "Medicaid", in_network: true },
    benefits: {
      calendar_year_maximum: { amount_cents: null, used_cents: null, remaining_cents: null },
      deductible: { individual_cents: 0, met_cents: 0, waived_for: ["all"] },
      preventive: { coverage_pct: 100, deductible_applies: false, copay_cents: 0,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 1, period: "calendar_year",
            last_service_date: "2026-06-15", next_eligible_date: null } } },
      basic_restorative: { coverage_pct: 100, deductible_applies: false,
        copay_cents: 300, composite_posterior_downgrade: false },
      major_restorative: { coverage_pct: 100, deductible_applies: false,
        copay_cents: 300, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
      medicaid_info: {
        state: "TX",
        program_name: "Texas Medicaid (TMHP)",
        prior_auth_required: ["D2750","D2751","D3310","D3320","D3330","D4341","D5110","D5120"],
        frequency_limits: {
          D1110: { max: 2, periodMonths: 12, used: 1 },
          D0120: { max: 2, periodMonths: 12, used: 1 },
          D0274: { max: 1, periodMonths: 12, used: 0 },
          D2750: { max: 1, periodMonths: 60, perTooth: true, used: 0 },
        },
        copays_cents: { D0120: 0, D1110: 0, D2750: 300, D3310: 300 },
      },
    },
  },

  // ── p7: Out-of-Network patient ───────────────────────────────────────────────
  p7: {
    _fixture_id: "271_oon_patient",
    subscriber: { member_id: "HUM-334-227-LC", first_name: "Lisa", last_name: "Chen",
      date_of_birth: "1987-06-12", group_number: "GRP-334227", plan_name: "Humana Dental Value PPO" },
    payer: { name: "Humana Dental", payer_id: "HUMANA" },
    coverage: { plan_status: "active", plan_begin_date: "2026-01-01", plan_end_date: "2026-12-31",
      insurance_type: "PPO", in_network: false },
    benefits: {
      calendar_year_maximum: { amount_cents: 100000, used_cents: 0, remaining_cents: 100000 },
      deductible: { individual_cents: 10000, met_cents: 0, waived_for: [] },
      preventive: { coverage_pct: 50, deductible_applies: true,
        frequency: { cleanings: { times_per_period: 2, used_this_period: 0, period: "calendar_year" } } },
      basic_restorative: { coverage_pct: 50, deductible_applies: true, composite_posterior_downgrade: false },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
    oon_estimate: {
      network_status: "out_of_network",
      procedure_code: "D2750",
      office_fee_cents: 145000,
      allowable_amount_cents: 98000,
      data_source: "historical_claims",
      data_source_label: "⚡ Sourced via Historical Claims Data",
      oon_coverage_pct: 50,
      remaining_deductible_cents: 10000,
      estimated_insurance_payment_cents: 44000,
      patient_responsibility_cents: 101000,
      waterfall_steps: [
        { step: 1, name: "Network Check",        status: "complete", result: "Out-of-Network — Humana not in provider credentialing list" },
        { step: 2, name: "Historical Scrubbing",  status: "complete", result: "Found 7 historical ERAs for D2750 / Humana — avg allowed: $980" },
        { step: 3, name: "RPA Scrape",            status: "skipped",  result: "Not needed — history data sufficient" },
        { step: 4, name: "Calculation",           status: "complete", result: "($980 − $100 ded) × 50% = $440 est. insurance pmt" },
      ],
    },
    assignment_of_benefits: {
      assigned_to_provider: false,
      entity: "subscriber",
      method: "reimbursement",
      raw_indicator: "N",
    },
  },
};

// ── Normalizer + helpers (extracted to lib/verifyHelpers.js for testability) ─
import { normalize271, deriveActionFlags, deriveVerificationStatus } from "../../../../lib/verifyHelpers.js";

// ── Stedi imports (dynamic to avoid breaking if lib not present) ──────────────
let stediVerify, resolvePayerId;
try {
  const stediMod = await import("../../../../lib/stedi.js");
  stediVerify    = stediMod.stediVerify;
  resolvePayerId = stediMod.resolvePayerId;
} catch (_) {
  // lib not available in this worktree path — will fall through to fixture
}

// ── Hardening imports ─────────────────────────────────────────────────────────
import { auth } from "@clerk/nextjs/server";
let logAudit, getClientIp, checkRateLimit, rateLimitResponse;
try {
  const auditMod = await import("../../../../lib/audit.js");
  logAudit = auditMod.logAudit;
  getClientIp = auditMod.getClientIp;
  const rlMod = await import("../../../../lib/rateLimit.js");
  checkRateLimit = rlMod.checkRateLimit;
  rateLimitResponse = rlMod.rateLimitResponse;
} catch (_) { /* graceful degradation */ }
import { checkPracticeActive } from "../../../../lib/practiceGate.js";
import { recordSuccess, recordFailure, getServiceStatus } from "../../../../lib/outageDetector.js";
import { enqueueRetry } from "../../../../lib/retryQueue.js";

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    // Auth check — required for PHI access
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 120 req/min per user (supports batch "Verify All" + retries across a full week)
    if (checkRateLimit && rateLimitResponse) {
      const rl = await checkRateLimit(`verify:${userId}`, { maxRequests: 120, windowMs: 60_000 });
      const blocked = rateLimitResponse(rl);
      if (blocked) return blocked;
    }

    const body = await request.json();
    const {
      patient_id,
      // Real patient fields — sent when we have actual data
      member_id,
      first_name,
      last_name,
      date_of_birth,
      insurance_name,
      payer_id,
      trigger,
    } = body;

    if (!patient_id) {
      return Response.json({ error: "patient_id is required." }, { status: 400 });
    }

    // ── Resolve practice ONCE at the top — used for all DB writes + audit ────
    let practice = null;
    let isSandbox = false;
    try {
      const { prisma: _p } = await import("../../../../lib/prisma.js");
      practice = await _p.practice.findUnique({ where: { clerkUserId: userId } });
      if (practice?.accountMode === "sandbox") isSandbox = true;
    } catch { /* if lookup fails, default to trying Stedi */ }

    // Practice suspension gate
    const gate = checkPracticeActive(practice);
    if (gate) return gate;

    // ── Try real Stedi call first ──────────────────────────────────────────────
    const stediKey = process.env.STEDI_API_KEY;
    const resolvedPayerId = resolvePayerId
      ? resolvePayerId(insurance_name, payer_id)
      : null;

    // Use Stedi if: key is set, we have a memberId, a payer ID we can resolve, AND not sandbox
    const canUseStedi = !isSandbox && stediKey && (member_id || body.memberId) && resolvedPayerId && stediVerify;

    if (canUseStedi) {
      // ── Check if Stedi is known-degraded (skip call to avoid piling up timeouts) ──
      const stediStatus = await getServiceStatus("stedi");
      if (stediStatus.status === "degraded") {
        console.warn("[verify] Stedi is degraded — skipping call, queueing retry");

        // Enqueue for automatic retry
        const patientData = {
          patient_id, member_id: member_id || body.memberId,
          firstName: first_name || body.firstName || "",
          lastName: last_name || body.lastName || "",
          dob: date_of_birth || body.dob || "",
          payerId: resolvedPayerId,
          insurance: insurance_name || body.insurance || "",
        };
        const { queued } = await enqueueRetry(practice?.id || "unknown", patientData, "stedi is degraded");

        return Response.json({
          status: "system_outage",
          service: "stedi",
          retryQueued: queued,
          degradedSince: stediStatus.degradedSince,
          message: "Insurance verification service is temporarily unavailable." +
            (queued ? " Verification has been queued for automatic retry." : " Please try again later."),
          verification_status: "pending_retry",
          plan_status: "unknown",
          _source: "outage",
          _failedAt: new Date().toISOString(),
        });
      }

      try {
        const t0 = Date.now();
        const { normalized, raw, durationMs } = await stediVerify({
          memberId:      member_id || body.memberId,
          firstName:     first_name || body.firstName || "",
          lastName:      last_name  || body.lastName  || "",
          dateOfBirth:   date_of_birth || body.dob || "",
          payerId:       resolvedPayerId,
          insuranceName: insurance_name || body.insurance || "",
        });

        // Record success for circuit breaker
        await recordSuccess("stedi").catch(() => {});

        // ZERO PHI AT REST: Verification results are returned directly to the
        // frontend and stored in React state only. No Postgres persistence.

        if (logAudit) logAudit({
          practiceId: practice?.id || null,
          userId,
          action: "verify.eligibility",
          resourceType: "Patient",
          resourceId: patient_id,
          ipAddress: getClientIp?.(request) || null,
          metadata: { source: "stedi", status: normalized.verification_status },
        });

        return Response.json({ ...normalized, _source: "stedi" });
      } catch (stediErr) {
        console.warn("[verify] Stedi call failed:", stediErr.message);
        // Categorize the error for the frontend
        const errMsg = (stediErr.message || "").toLowerCase();
        let failCategory = "unknown";
        let failDetail = stediErr.message || "Verification call failed";
        if (errMsg.includes("401") || errMsg.includes("unauthorized") || errMsg.includes("authentication"))
          failCategory = "auth_failed";
        else if (errMsg.includes("member") && errMsg.includes("not found"))
          failCategory = "member_not_found";
        else if (errMsg.includes("timeout") || errMsg.includes("timed out") || errMsg.includes("aborted"))
          failCategory = "payer_timeout";
        else if (errMsg.includes("429") || errMsg.includes("rate"))
          failCategory = "rate_limited";
        else if (errMsg.includes("payer") && (errMsg.includes("not supported") || errMsg.includes("unknown")))
          failCategory = "payer_unsupported";
        else if (errMsg.includes("dob") || errMsg.includes("date of birth") || errMsg.includes("invalid date"))
          failCategory = "invalid_dob";
        else if (errMsg.includes("500") || errMsg.includes("502") || errMsg.includes("503"))
          failCategory = "payer_system_error";
        else if (errMsg.includes("network") || errMsg.includes("econnrefused") || errMsg.includes("fetch"))
          failCategory = "network_error";

        // Determine if this is a system error (should trigger retry) vs user error
        const isSystemError = ["payer_timeout", "payer_system_error", "network_error", "rate_limited", "unknown"].includes(failCategory);

        if (isSystemError) {
          // Record failure for circuit breaker
          await recordFailure("stedi").catch(() => {});

          // Enqueue for automatic retry
          const patientData = {
            patient_id, member_id: member_id || body.memberId,
            firstName: first_name || body.firstName || "",
            lastName: last_name || body.lastName || "",
            dob: date_of_birth || body.dob || "",
            payerId: resolvedPayerId,
            insurance: insurance_name || body.insurance || "",
          };
          const { queued } = await enqueueRetry(practice?.id || "unknown", patientData, failDetail);

          return Response.json({
            status: "system_outage",
            service: "stedi",
            retryQueued: queued,
            verification_status: "pending_retry",
            plan_status: "unknown",
            _source: "stedi_error",
            _failCategory: failCategory,
            _failReason: failDetail,
            _failedAt: new Date().toISOString(),
            message: "Insurance verification service is temporarily unavailable." +
              (queued ? " Verification has been queued for automatic retry." : " Please try again later."),
          });
        }

        // User/data errors — return as-is (no retry, no outage detection)
        return Response.json({
          verification_status: "error",
          plan_status: "unknown",
          _source: "stedi_error",
          _failCategory: failCategory,
          _failReason: failDetail,
          _failedAt: new Date().toISOString(),
        });
      }
    }

    // ── Live mode without Stedi → structured warning, not silent fixture ─────
    if (!isSandbox && !canUseStedi) {
      const reasons = [];
      let failCategory = "missing_config";
      if (!stediKey) reasons.push("STEDI_API_KEY not configured");
      if (!member_id && !body.memberId) { reasons.push("no member ID on file"); failCategory = "missing_member_id"; }
      if (!resolvedPayerId) { reasons.push("payer not recognized"); failCategory = "payer_unsupported"; }
      console.warn(`[verify] Live mode but can't use Stedi: ${reasons.join(", ")}.`);

      return Response.json({
        verification_status: "error",
        plan_status: "unknown",
        _source: "config_error",
        _failCategory: failCategory,
        _failReason: reasons.join("; "),
        _failedAt: new Date().toISOString(),
        _configIssues: reasons,
      });
    }

    // ── Fixture fallback (sandbox mode only) ────────────────────────────────
    const fixture = FIXTURES[patient_id];
    if (!fixture) {
      // For directory patients with no fixture, return a generic active plan
      const genericResult = normalize271(FIXTURES["p1"]);
      return Response.json({
        ...genericResult,
        _source:   "mock_generic",
        _fixture_id: "generic_active",
        subscriber: {
          ...genericResult.subscriber,
          member_id:  member_id || body.memberId || "UNKNOWN",
          first_name: first_name || body.firstName || "Patient",
          last_name:  last_name  || body.lastName  || "",
        },
      });
    }

    const result = normalize271(fixture);

    if (logAudit) logAudit({
      practiceId: practice?.id || null,
      userId,
      action: "verify.eligibility",
      resourceType: "Patient",
      resourceId: patient_id,
      ipAddress: getClientIp?.(request) || null,
      metadata: { source: "fixture", status: result.verification_status },
    });

    return Response.json({ ...result, _source: "fixture" });

  } catch (err) {
    console.error("[verify] Error:", err.name, err.message?.slice(0, 100));
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 500 }
    );
  }
}
