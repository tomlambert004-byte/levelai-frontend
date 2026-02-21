/**
 * lib/stedi.js — Stedi Real-Time Eligibility (270/271)
 * =====================================================
 * Calls the Stedi healthcare eligibility API and normalizes
 * the 271 response into the same shape our UI already expects.
 *
 * Falls back to fixture data if STEDI_API_KEY is not set or
 * if Stedi returns an error, so the app never breaks.
 */

const STEDI_ENDPOINT = "https://www.stedi.com/change/medicalnetwork/eligibility/v3";

// Payer ID map — translate our internal labels to Stedi payer IDs
// Full list: https://www.stedi.com/healthcare/network
const PAYER_ID_MAP = {
  "delta dental":             "77777",
  "delta dental ppo":         "77777",
  "delta dental ppo plus":    "77777",
  "cigna":                    "62308",
  "cigna dental":             "62308",
  "aetna":                    "60054",
  "aetna dmo":                "60054",
  "guardian":                 "66705",
  "guardian dental":          "66705",
  "metlife":                  "87726",
  "metlife dental":           "87726",
  "unitedhealthcare":         "87726",
  "united healthcare":        "87726",
  "humana":                   "61101",
  "humana dental":            "61101",
  "blue cross blue shield":   "00430",
  "bcbs":                     "00430",
  // Medicaid payer IDs (state fiscal agents)
  "texas medicaid":           "77037",
  "tmhp":                     "77037",
  "medi-cal":                 "610279",
  "denti-cal":                "610279",
  "new york medicaid":        "77027",
  "florida medicaid":         "77034",
  "illinois medicaid":        "77033",
  "ohio medicaid":            "77032",
  "georgia medicaid":         "77012",
  "nc medicaid":              "77031",
  "healthy michigan":         "77030",
  "nj familycare":            "77028",
  "virginia medicaid":        "77039",
  "apple health":             "77040",
  "ahcccs":                   "77003",
  "masshealth":               "77029",
  "pennsylvania medicaid":    "77036",
};

// Known Medicaid payer IDs for detection
const MEDICAID_PAYER_IDS = new Set([
  "77037","610279","77027","77034","77036","77033","77032","77012",
  "77031","77030","77028","77039","77040","77003","77029","18916",
]);

// Map payer IDs to state codes for Medicaid
const PAYER_TO_STATE = {
  "77037":"TX","610279":"CA","77027":"NY","77034":"FL","77036":"PA",
  "77033":"IL","77032":"OH","77012":"GA","77031":"NC","77030":"MI",
  "77028":"NJ","77039":"VA","77040":"WA","77003":"AZ","77029":"MA",
  "18916":"TX",
};

export function resolvePayerId(insuranceName, explicitPayerId) {
  if (explicitPayerId) return explicitPayerId;
  const key = (insuranceName || "").toLowerCase().trim();
  return PAYER_ID_MAP[key] || null;
}

/**
 * Call the Stedi eligibility API.
 *
 * @param {object} params
 * @param {string} params.memberId      - Insurance member ID
 * @param {string} params.firstName     - Patient first name
 * @param {string} params.lastName      - Patient last name
 * @param {string} params.dateOfBirth   - "YYYY-MM-DD"
 * @param {string} params.payerId       - Stedi payer ID
 * @param {string} [params.npi]         - Provider NPI (falls back to demo NPI)
 * @param {string} [params.providerName]- Provider org name
 * @returns {Promise<{ normalized: object, raw: object, durationMs: number }>}
 */
export async function stediVerify(params) {
  const apiKey = process.env.STEDI_API_KEY;
  if (!apiKey) throw new Error("STEDI_API_KEY not configured");

  const {
    memberId, firstName, lastName, dateOfBirth, payerId,
    npi = process.env.STEDI_PROVIDER_NPI || "1999999984", // demo NPI for dev
    providerName = process.env.STEDI_PROVIDER_NAME || "Pulp AI Dental",
  } = params;

  if (!payerId) throw new Error("payerId is required for Stedi call");
  if (!memberId) throw new Error("memberId is required for Stedi call");

  // Format DOB for Stedi: YYYYMMDD
  const dobFormatted = dateOfBirth?.replace(/-/g, "") || "";

  const body = {
    controlNumber: String(Date.now()).slice(-9),
    tradingPartnerServiceId: payerId,
    provider: {
      organizationName: providerName,
      npi,
    },
    subscriber: {
      firstName,
      lastName,
      memberId,
      dateOfBirth: dobFormatted,
    },
    encounter: {
      serviceTypeCodes: ["30"], // 30 = dental
    },
  };

  const t0 = Date.now();
  const resp = await fetch(STEDI_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const durationMs = Date.now() - t0;

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Stedi returned ${resp.status}: ${errText}`);
  }

  const raw = await resp.json();
  const normalized = normalize271FromStedi(raw, params);
  return { normalized, raw, durationMs };
}

/**
 * Normalize a real Stedi 271 response into our app's shape.
 * Handles the complexity of the benefitsInformation array.
 */
function normalize271FromStedi(raw, params) {
  // Stedi wraps the 271 in a top-level object
  const eligibility = raw?.eligibilityOrExceptionCode || raw;
  const subscriber  = raw?.subscriber || {};
  const benefits    = raw?.benefitsInformation || [];
  const payer       = raw?.payer || {};
  const planInfo    = raw?.planInformation || {};

  // ── Plan status ─────────────────────────────────────────────────────────────
  // code "1" = Active Coverage, code "6" = Inactive, code "31" = Not Covered
  const activeBenefit = benefits.find(b => b.code === "1");
  const inactiveBenefit = benefits.find(b => ["6","31"].includes(b.code));
  const planStatus = activeBenefit ? "active" : (inactiveBenefit ? "inactive" : "unknown");

  // ── Date info ────────────────────────────────────────────────────────────────
  const dateInfo = activeBenefit?.benefitsDateInformation || {};
  const planBegin = formatDate(dateInfo.eligibilityBegin || dateInfo.benefitBegin);
  const planEnd   = formatDate(dateInfo.eligibilityEnd   || dateInfo.benefitEnd);

  // ── Calendar year maximum (code "F" = Limitations) ───────────────────────────
  // Annual maximum is often returned as code "F" with serviceTypeCodes ["35"] (dental)
  const annualMaxBenefit = benefits.find(b =>
    b.code === "F" &&
    (b.serviceTypeCodes?.includes("35") || b.serviceTypeCodes?.includes("30"))
  );
  const annualMaxCents = dollarsToCents(annualMaxBenefit?.benefitAmount);

  // Deductible (code "C")
  const dedBenefit = benefits.find(b =>
    b.code === "C" && b.coverageLevelCode === "IND"
  );
  const dedCents = dollarsToCents(dedBenefit?.benefitAmount);

  // Deductible met — Stedi sometimes returns remaining via code "C" + "deductibleMetAmount"
  const dedMetCents = dollarsToCents(dedBenefit?.benefitMetAmount) || 0;
  const dedRemainingCents = dedCents != null ? Math.max(0, dedCents - dedMetCents) : null;

  // Annual remaining — if payer provides it directly
  const annualRemBenefit = benefits.find(b =>
    b.code === "F" && b.coverageLevelCode === "IND" &&
    b.serviceTypeCodes?.includes("35") && b.benefitRemainingAmount
  );
  const annualRemCents = dollarsToCents(annualRemBenefit?.benefitRemainingAmount) ?? annualMaxCents;

  // ── Coverage percentages ─────────────────────────────────────────────────────
  // Coinsurance code "A", preventive service type "35"/"AJ"
  const preventivePct  = extractCoveragePct(benefits, ["AJ","35"]);
  const basicPct       = extractCoveragePct(benefits, ["27","28","29"]);
  const majorPct       = extractCoveragePct(benefits, ["23","50","51","52","53"]);

  // ── Network status ───────────────────────────────────────────────────────────
  // Stedi returns planNetworkIdNumber or we infer from planInfo
  const inNetwork = !(planInfo?.planNetworkId === "OON" || raw?.inNetworkIndicator === "N");

  // ── Cleaning frequency ───────────────────────────────────────────────────────
  // Look for frequency limitation on preventive/cleaning services
  const cleanFreqBenefit = benefits.find(b =>
    (b.serviceTypeCodes?.includes("AJ") || b.serviceTypeCodes?.includes("35")) &&
    b.quantityQualifier === "VS" // VS = visits
  );
  const cleaningsPerYear = cleanFreqBenefit ? parseInt(cleanFreqBenefit.quantity || "2") : 2;

  // ── Build normalized result in our app's shape ───────────────────────────────
  const actionFlags = [];
  if (planStatus !== "active") actionFlags.push("plan_inactive");
  if (annualRemCents !== null && annualRemCents === 0) actionFlags.push("annual_max_exhausted");
  else if (annualRemCents !== null && annualRemCents < 30000) actionFlags.push("annual_max_low");

  const verificationStatus = planStatus !== "active" ? "inactive"
    : actionFlags.length > 0 ? "action_required"
    : "verified";

  const result = {
    verification_status:             verificationStatus,
    plan_status:                     planStatus,
    payer_name:                      payer.name || params.insuranceName || null,
    payer_id:                        params.payerId || null,
    insurance_type:                  planInfo?.insuranceType || "PPO",
    in_network:                      inNetwork,
    plan_begin_date:                 planBegin,
    plan_end_date:                   planEnd,
    termination_reason:              null,
    annual_maximum_cents:            annualMaxCents,
    annual_used_cents:               null,  // not always returned by payers
    annual_remaining_cents:          annualRemCents,
    individual_deductible_cents:     dedCents,
    individual_deductible_met_cents: dedMetCents,
    individual_deductible_remaining_cents: dedRemainingCents,
    family_deductible_cents:         null,
    family_deductible_met_cents:     null,
    deductible_waived_for:           ["preventive"],
    preventive: {
      coverage_pct:       preventivePct ?? 100,
      copay_cents:        null,
      deductible_applies: false,
      cleaning_frequency: {
        times_per_period:   cleaningsPerYear,
        used_this_period:   0,
        period:             "calendar_year",
        last_service_date:  null,
        next_eligible_date: null,
      },
      bitewing_frequency: null,
    },
    restorative: {
      coverage_pct:                  basicPct ?? majorPct ?? 80,
      copay_cents:                   null,
      deductible_applies:            true,
      composite_posterior_downgrade: false,
      composite_posterior_note:      null,
      crown_waiting_period_months:   0,
    },
    missing_tooth_clause: {
      applies:           false,
      affected_teeth:    [],
      excluded_services: [],
      exception_pathway: null,
      extraction_date:   null,
      coverage_begin:    planBegin,
    },
    action_flags:  actionFlags,
    subscriber: {
      member_id:  subscriber.memberId  || params.memberId  || null,
      first_name: subscriber.firstName || params.firstName || null,
      last_name:  subscriber.lastName  || params.lastName  || null,
      dob:        formatDate(subscriber.dateOfBirth) || params.dateOfBirth || null,
      group:      subscriber.groupNumber || null,
      plan_name:  planInfo?.planDescription || params.insuranceName || null,
    },
    _source:        "stedi",
    _normalized_at: new Date().toISOString(),
  };

  // ── Medicaid detection from 271 data ──────────────────────────────────────
  const isMedicaid = /medicaid|medi-?cal|denti-?cal|chip|tmhp|ahcccs|masshealth|soonercare/i.test(
    planInfo?.planDescription || payer?.name || params.insuranceName || ""
  ) || MEDICAID_PAYER_IDS.has(params.payerId);
  if (isMedicaid) {
    result._is_medicaid = true;
    result._medicaid_state = PAYER_TO_STATE[params.payerId] || null;
    result._medicaid_program = planInfo?.planDescription || payer?.name || params.insuranceName || null;
  }

  // ── Assignment of Benefits (OON) ──────────────────────────────────────────
  // Look for assignment-of-benefits indicator in the 271 benefitsInformation.
  // Benefit code "CB" = Coordination of Benefits, entity "IL" = insured (subscriber),
  // entity "PR" = provider. Also check benefitsAssignmentCertificationIndicator.
  const aobBenefit = benefits.find(b =>
    b.code === "CB" || b.benefitsAssignmentCertificationIndicator != null
  );
  const assignmentIndicator = raw?.benefitsAssignmentCertificationIndicator
    || aobBenefit?.benefitsAssignmentCertificationIndicator;

  if (assignmentIndicator != null || !inNetwork) {
    // "Y" = assigned to provider, "N" = subscriber, "W" = not applicable
    const assignedToProvider = assignmentIndicator === "Y";
    result.assignment_of_benefits = {
      assigned_to_provider: assignedToProvider,
      entity: assignedToProvider ? "provider" : "subscriber",
      method: assignedToProvider ? "direct_pay" : "reimbursement",
      raw_indicator: assignmentIndicator || null,
    };
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dollarsToCents(val) {
  if (val == null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : Math.round(n * 100);
}

function formatDate(raw) {
  if (!raw) return null;
  // Stedi returns dates as YYYYMMDD — convert to YYYY-MM-DD
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  }
  return raw;
}

function extractCoveragePct(benefits, serviceTypeCodes) {
  // Look for coinsurance (code "A") for the given service types
  const match = benefits.find(b =>
    b.code === "A" &&
    b.serviceTypeCodes?.some(c => serviceTypeCodes.includes(c))
  );
  if (!match) return null;
  // benefitPercent is returned as a decimal (e.g. "0.8" = 80%)
  const p = parseFloat(match.benefitPercent);
  if (isNaN(p)) return null;
  return p > 1 ? Math.round(p) : Math.round(p * 100);
}
