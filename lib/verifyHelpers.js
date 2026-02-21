/**
 * Verification Helpers — extracted from app/api/v1/verify/route.js
 *
 * Pure functions for normalizing 271 eligibility responses, deriving action
 * flags, and determining verification status. No side effects, no I/O.
 *
 * Used by:
 *   - app/api/v1/verify/route.js (production)
 *   - __tests__/verify-*.test.js  (test suite)
 */

// ── Normalizer ──────────────────────────────────────────────────────────────

/**
 * Transforms a raw 271-style fixture/API response into a flat, frontend-ready
 * verification result object.
 *
 * @param {object} raw — raw fixture with subscriber, payer, coverage, benefits
 * @returns {object} — normalized verification result
 */
export function normalize271(raw) {
  const coverage = raw.coverage || {};
  const benefits = raw.benefits || {};
  const payer    = raw.payer    || {};
  const sub      = raw.subscriber || {};

  const planStatus = coverage.plan_status || "unknown";
  const yrMax      = benefits.calendar_year_maximum || {};
  const annualMax  = yrMax.amount_cents ?? null;
  const annualRem  = yrMax.remaining_cents ?? null;

  const ded    = benefits.deductible || {};
  const dedInd = ded.individual_cents ?? null;
  const dedMet = ded.met_cents ?? 0;

  const prev      = benefits.preventive || {};
  const prevFreq  = prev.frequency || {};
  const cleanFreq = prevFreq.cleanings || null;
  const bwFreq    = prevFreq.bitewing_xrays || null;

  const preventiveOut = {
    coverage_pct:       prev.coverage_pct ?? null,
    copay_cents:        prev.copay_cents ?? null,
    deductible_applies: prev.deductible_applies ?? false,
    cleaning_frequency: cleanFreq ? {
      times_per_period:   cleanFreq.times_per_period ?? 2,
      used_this_period:   cleanFreq.used_this_period ?? 0,
      period:             cleanFreq.period ?? "calendar_year",
      last_service_date:  cleanFreq.last_service_date ?? null,
      next_eligible_date: cleanFreq.next_eligible_date ?? null,
    } : null,
    bitewing_frequency: bwFreq ? {
      times_per_period:   bwFreq.times_per_period ?? 1,
      used_this_period:   bwFreq.used_this_period ?? 0,
      next_eligible_date: bwFreq.next_eligible_date ?? null,
    } : null,
  };

  const basic = benefits.basic_restorative || {};
  const major = benefits.major_restorative || {};
  const restCovPct = basic.coverage_pct ?? major.coverage_pct ?? null;

  const restorativeOut = {
    coverage_pct:                  restCovPct,
    copay_cents:                   basic.copay_cents ?? null,
    deductible_applies:            basic.deductible_applies ?? true,
    composite_posterior_downgrade: basic.composite_posterior_downgrade ?? false,
    composite_posterior_note:      basic.composite_posterior_downgrade_note ?? null,
    crown_waiting_period_months:   major.waiting_period_months ?? 0,
  };

  const mtc = benefits.missing_tooth_clause || {};
  const mtcOut = {
    applies:           mtc.applies ?? false,
    affected_teeth:    mtc.affected_teeth ?? [],
    excluded_services: mtc.excluded_services ?? [],
    exception_pathway: mtc.exception_pathway ?? null,
    extraction_date:   mtc.extraction_date_on_file ?? null,
    coverage_begin:    coverage.plan_begin_date ?? null,
  };

  const actionFlags = deriveActionFlags(planStatus, annualRem, dedMet, dedInd, cleanFreq, mtcOut, basic, major);
  const verificationStatus = deriveVerificationStatus(planStatus, actionFlags);

  const result = {
    verification_status:             verificationStatus,
    plan_status:                     planStatus,
    payer_name:                      payer.name ?? null,
    payer_id:                        payer.payer_id ?? null,
    insurance_type:                  coverage.insurance_type ?? null,
    in_network:                      coverage.in_network ?? true,
    plan_begin_date:                 coverage.plan_begin_date ?? null,
    plan_end_date:                   coverage.plan_end_date ?? null,
    termination_reason:              coverage.termination_reason ?? null,
    annual_maximum_cents:            annualMax,
    annual_used_cents:               yrMax.used_cents ?? null,
    annual_remaining_cents:          annualRem,
    individual_deductible_cents:     dedInd,
    individual_deductible_met_cents: dedMet,
    family_deductible_cents:         ded.family_cents ?? null,
    family_deductible_met_cents:     ded.family_met_cents ?? null,
    deductible_waived_for:           ded.waived_for ?? [],
    preventive:                      preventiveOut,
    restorative:                     restorativeOut,
    missing_tooth_clause:            mtcOut,
    action_flags:                    actionFlags,
    subscriber: {
      member_id:  sub.member_id  ?? null,
      first_name: sub.first_name ?? null,
      last_name:  sub.last_name  ?? null,
      dob:        sub.date_of_birth ?? null,
      group:      sub.group_number ?? null,
      plan_name:  sub.plan_name  ?? null,
    },
    _fixture_id:    raw._fixture_id ?? null,
    _normalized_at: new Date().toISOString(),
  };

  // Attach OON estimate block if present
  if (raw.oon_estimate) {
    result.oon_estimate = raw.oon_estimate;
  }

  // Attach assignment of benefits if present
  if (raw.assignment_of_benefits) {
    result.assignment_of_benefits = raw.assignment_of_benefits;
  }

  // Attach Medicaid info if present
  if (raw._is_medicaid || (coverage.insurance_type || "").toLowerCase() === "medicaid") {
    result._is_medicaid = true;
    result._medicaid_state = raw._medicaid_state || null;
    result._medicaid_program = payer.name || null;
    if (benefits.medicaid_info) {
      result.medicaid_info = benefits.medicaid_info;
    }
  }

  return result;
}

// ── Action Flags ────────────────────────────────────────────────────────────

/**
 * Derives action flags from coverage data.
 * Flags indicate conditions that require front-desk attention.
 */
export function deriveActionFlags(planStatus, annualRem, dedMet, dedInd, cleanFreq, mtc, basic, major) {
  const flags = [];
  if (planStatus !== "active") { flags.push("plan_inactive"); return flags; }
  if (mtc.applies) {
    flags.push("missing_tooth_clause");
    if ((mtc.excluded_services || []).length > 0) flags.push("pre_auth_required");
  }
  if (cleanFreq) {
    const used  = cleanFreq.used_this_period ?? 0;
    const total = cleanFreq.times_per_period ?? 2;
    if (used >= total) flags.push("frequency_limit");
  }
  if (annualRem !== null && annualRem === 0) flags.push("annual_max_exhausted");
  else if (annualRem !== null && annualRem < 30000) flags.push("annual_max_low");
  if (basic.composite_posterior_downgrade) flags.push("composite_downgrade");
  if ((major.waiting_period_months ?? 0) > 0) flags.push("waiting_period_active");
  return flags;
}

// ── Verification Status ─────────────────────────────────────────────────────

/**
 * Maps plan status + action flags to a final verification status.
 *
 * @returns {"verified" | "action_required" | "inactive"}
 */
export function deriveVerificationStatus(planStatus, actionFlags) {
  if (planStatus !== "active") return "inactive";
  const critical = new Set([
    "plan_inactive","missing_tooth_clause","pre_auth_required",
    "frequency_limit","annual_max_exhausted","annual_max_low",
    "composite_downgrade","waiting_period_active",
  ]);
  if (actionFlags.some(f => critical.has(f))) return "action_required";
  return "verified";
}
