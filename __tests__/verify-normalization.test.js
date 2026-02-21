/**
 * Verification Normalization Tests
 *
 * Tests the normalize271() function against all fixture scenarios to ensure
 * correct transformation of raw 271 eligibility data into the frontend format.
 */
import { describe, it, expect } from "vitest";
import { normalize271 } from "../lib/verifyHelpers.js";

// ── Fixtures (inline — same as verify route) ────────────────────────────────
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
      deductible: { individual_cents: 5000, met_cents: 0, family_cents: 15000, family_met_cents: 0 },
      preventive: { coverage_pct: 100, deductible_applies: false },
      basic_restorative: { coverage_pct: 80, deductible_applies: true },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 12 },
      missing_tooth_clause: {
        applies: true,
        affected_teeth: ["#14"],
        extraction_date_on_file: "2024-03-10",
        excluded_services: ["D6010 — Implant body placement"],
        exception_pathway: "Submit pre-authorization with dated extraction records.",
      },
    },
  },
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
      preventive: { coverage_pct: 50, deductible_applies: true },
      basic_restorative: { coverage_pct: 50, deductible_applies: true },
      major_restorative: { coverage_pct: 50, deductible_applies: true, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
    },
    oon_estimate: {
      network_status: "out_of_network",
      patient_responsibility_cents: 101000,
    },
    assignment_of_benefits: { assigned_to_provider: false, entity: "subscriber" },
  },
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
      calendar_year_maximum: { amount_cents: null },
      deductible: { individual_cents: 0, met_cents: 0, waived_for: ["all"] },
      preventive: { coverage_pct: 100, deductible_applies: false, copay_cents: 0 },
      basic_restorative: { coverage_pct: 100, deductible_applies: false, copay_cents: 300 },
      major_restorative: { coverage_pct: 100, deductible_applies: false, copay_cents: 300, waiting_period_months: 0 },
      missing_tooth_clause: { applies: false },
      medicaid_info: { state: "TX", program_name: "Texas Medicaid (TMHP)" },
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("normalize271", () => {
  it("normalizes an active clean plan (p1)", () => {
    const result = normalize271(FIXTURES.p1);
    expect(result.verification_status).toBe("verified");
    expect(result.plan_status).toBe("active");
    expect(result.payer_name).toBe("Delta Dental PPO");
    expect(result.annual_maximum_cents).toBe(200000);
    expect(result.annual_remaining_cents).toBe(145000);
    expect(result.individual_deductible_cents).toBe(5000);
    expect(result.individual_deductible_met_cents).toBe(5000);
    expect(result.in_network).toBe(true);
    expect(result.action_flags).toEqual([]);
    expect(result.subscriber.member_id).toBe("DD00112233");
    expect(result.subscriber.first_name).toBe("Margaret");
    expect(result.preventive.coverage_pct).toBe(100);
    expect(result.restorative.coverage_pct).toBe(80);
    expect(result.restorative.composite_posterior_downgrade).toBe(false);
    expect(result.missing_tooth_clause.applies).toBe(false);
  });

  it("normalizes an inactive plan (p3)", () => {
    const result = normalize271(FIXTURES.p3);
    expect(result.verification_status).toBe("inactive");
    expect(result.plan_status).toBe("inactive");
    expect(result.termination_reason).toBe("employment_terminated");
    expect(result.action_flags).toContain("plan_inactive");
    expect(result.annual_remaining_cents).toBe(0);
  });

  it("normalizes a missing tooth clause plan (p4)", () => {
    const result = normalize271(FIXTURES.p4);
    expect(result.verification_status).toBe("action_required");
    expect(result.plan_status).toBe("active");
    expect(result.missing_tooth_clause.applies).toBe(true);
    expect(result.missing_tooth_clause.affected_teeth).toContain("#14");
    expect(result.missing_tooth_clause.excluded_services.length).toBeGreaterThan(0);
    expect(result.missing_tooth_clause.exception_pathway).toBeTruthy();
    expect(result.action_flags).toContain("missing_tooth_clause");
    expect(result.action_flags).toContain("pre_auth_required");
    expect(result.action_flags).toContain("waiting_period_active");
  });

  it("normalizes an OON patient with estimate (p7)", () => {
    const result = normalize271(FIXTURES.p7);
    expect(result.verification_status).toBe("verified");
    expect(result.in_network).toBe(false);
    expect(result.oon_estimate).toBeDefined();
    expect(result.oon_estimate.network_status).toBe("out_of_network");
    expect(result.assignment_of_benefits).toBeDefined();
    expect(result.assignment_of_benefits.assigned_to_provider).toBe(false);
  });

  it("normalizes a Medicaid patient (p8)", () => {
    const result = normalize271(FIXTURES.p8);
    expect(result.verification_status).toBe("verified");
    expect(result._is_medicaid).toBe(true);
    expect(result._medicaid_state).toBe("TX");
    expect(result.medicaid_info).toBeDefined();
    expect(result.medicaid_info.state).toBe("TX");
    expect(result.individual_deductible_cents).toBe(0);
  });

  it("includes _normalized_at timestamp", () => {
    const result = normalize271(FIXTURES.p1);
    expect(result._normalized_at).toBeTruthy();
    // Should be a valid ISO date
    expect(() => new Date(result._normalized_at)).not.toThrow();
  });

  it("handles completely empty input gracefully", () => {
    const result = normalize271({});
    expect(result.verification_status).toBe("inactive"); // unknown plan_status → inactive
    expect(result.plan_status).toBe("unknown");
    expect(result.payer_name).toBeNull();
    expect(result.annual_maximum_cents).toBeNull();
    expect(result.action_flags).toContain("plan_inactive");
  });
});
