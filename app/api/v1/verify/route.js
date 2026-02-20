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
  },
};

// ── Normalizer (JS port of backend/normalizer.py) ────────────────────────────
function normalize271(raw) {
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

  // Attach OON estimate block if present in fixture
  if (raw.oon_estimate) {
    result.oon_estimate = raw.oon_estimate;
  }

  return result;
}

function deriveActionFlags(planStatus, annualRem, dedMet, dedInd, cleanFreq, mtc, basic, major) {
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

function deriveVerificationStatus(planStatus, actionFlags) {
  if (planStatus !== "active") return "inactive";
  const critical = new Set([
    "plan_inactive","missing_tooth_clause","pre_auth_required",
    "frequency_limit","annual_max_exhausted","annual_max_low",
    "composite_downgrade","waiting_period_active",
  ]);
  if (actionFlags.some(f => critical.has(f))) return "action_required";
  return "verified";
}

// ── Stedi imports (dynamic to avoid breaking if lib not present) ──────────────
let stediVerify, resolvePayerId;
try {
  const stediMod = await import("../../../../lib/stedi.js");
  stediVerify    = stediMod.stediVerify;
  resolvePayerId = stediMod.resolvePayerId;
} catch (_) {
  // lib not available in this worktree path — will fall through to fixture
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
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

    // ── Try real Stedi call first ──────────────────────────────────────────────
    const stediKey = process.env.STEDI_API_KEY;
    const resolvedPayerId = resolvePayerId
      ? resolvePayerId(insurance_name, payer_id)
      : null;

    // Use Stedi if: key is set, we have a memberId, and a payer ID we can resolve
    const canUseStedi = stediKey && (member_id || body.memberId) && resolvedPayerId && stediVerify;

    if (canUseStedi) {
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

        // Store to Postgres if prisma is available
        try {
          const { prisma } = await import("../../../../lib/prisma.js");
          await prisma.verificationResult.create({
            data: {
              practiceId:        "demo",   // replaced once auth is wired
              memberIdUsed:      member_id || body.memberId || null,
              payerIdUsed:       resolvedPayerId,
              trigger:           trigger || "manual",
              verificationStatus: normalized.verification_status,
              planStatus:        normalized.plan_status,
              payerName:         normalized.payer_name,
              source:            "stedi",
              rawResponse:       raw,
              normalizedResult:  normalized,
              durationMs,
            },
          });
        } catch (_dbErr) {
          // DB write is non-blocking — don't fail the request
        }

        return Response.json({ ...normalized, _source: "stedi" });
      } catch (stediErr) {
        console.warn("[verify] Stedi call failed, falling back to fixture:", stediErr.message);
        // Fall through to fixture
      }
    }

    // ── Fixture fallback ───────────────────────────────────────────────────────
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
    return Response.json({ ...result, _source: canUseStedi ? "stedi_fallback_fixture" : "fixture" });

  } catch (err) {
    return Response.json(
      { error: "Verification failed.", detail: err.message },
      { status: 500 }
    );
  }
}
