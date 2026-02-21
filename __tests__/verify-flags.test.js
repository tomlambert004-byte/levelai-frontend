/**
 * Action Flag + Verification Status Tests
 *
 * Tests deriveActionFlags() and deriveVerificationStatus() to ensure
 * every blocking condition is correctly detected and the final status
 * maps to the right category.
 */
import { describe, it, expect } from "vitest";
import { deriveActionFlags, deriveVerificationStatus } from "../lib/verifyHelpers.js";

// ── Helper: build cleanFreq ─────────────────────────────────────────────────
const freq = (used, total = 2) => ({ used_this_period: used, times_per_period: total });
const noMtc = { applies: false, excluded_services: [] };
const noBasic = { composite_posterior_downgrade: false };
const noMajor = { waiting_period_months: 0 };

// ── deriveActionFlags ───────────────────────────────────────────────────────

describe("deriveActionFlags", () => {
  it("returns empty flags for a clean active plan", () => {
    const flags = deriveActionFlags("active", 145000, 5000, 5000, freq(1), noMtc, noBasic, noMajor);
    expect(flags).toEqual([]);
  });

  it("returns plan_inactive for non-active plans", () => {
    const flags = deriveActionFlags("inactive", 0, 0, 0, null, noMtc, noBasic, noMajor);
    expect(flags).toEqual(["plan_inactive"]);
  });

  it("flags missing_tooth_clause + pre_auth_required", () => {
    const mtc = { applies: true, excluded_services: ["D6010 — Implant"] };
    const flags = deriveActionFlags("active", 100000, 0, 5000, null, mtc, noBasic, noMajor);
    expect(flags).toContain("missing_tooth_clause");
    expect(flags).toContain("pre_auth_required");
  });

  it("flags missing_tooth_clause WITHOUT pre_auth when no excluded services", () => {
    const mtc = { applies: true, excluded_services: [] };
    const flags = deriveActionFlags("active", 100000, 0, 5000, null, mtc, noBasic, noMajor);
    expect(flags).toContain("missing_tooth_clause");
    expect(flags).not.toContain("pre_auth_required");
  });

  it("flags frequency_limit when cleanings used up", () => {
    const flags = deriveActionFlags("active", 100000, 5000, 5000, freq(2, 2), noMtc, noBasic, noMajor);
    expect(flags).toContain("frequency_limit");
  });

  it("does NOT flag frequency_limit when cleanings remain", () => {
    const flags = deriveActionFlags("active", 100000, 5000, 5000, freq(1, 2), noMtc, noBasic, noMajor);
    expect(flags).not.toContain("frequency_limit");
  });

  it("flags annual_max_exhausted when remaining is 0", () => {
    const flags = deriveActionFlags("active", 0, 5000, 5000, null, noMtc, noBasic, noMajor);
    expect(flags).toContain("annual_max_exhausted");
  });

  it("flags annual_max_low when remaining < $300", () => {
    const flags = deriveActionFlags("active", 22000, 5000, 5000, null, noMtc, noBasic, noMajor);
    expect(flags).toContain("annual_max_low");
  });

  it("does NOT flag annual_max_low when remaining >= $300", () => {
    const flags = deriveActionFlags("active", 30000, 5000, 5000, null, noMtc, noBasic, noMajor);
    expect(flags).not.toContain("annual_max_low");
    expect(flags).not.toContain("annual_max_exhausted");
  });

  it("flags composite_downgrade", () => {
    const basic = { composite_posterior_downgrade: true };
    const flags = deriveActionFlags("active", 100000, 5000, 5000, null, noMtc, basic, noMajor);
    expect(flags).toContain("composite_downgrade");
  });

  it("flags waiting_period_active", () => {
    const major = { waiting_period_months: 12 };
    const flags = deriveActionFlags("active", 100000, 0, 5000, null, noMtc, noBasic, major);
    expect(flags).toContain("waiting_period_active");
  });

  it("can produce multiple flags simultaneously", () => {
    const mtc = { applies: true, excluded_services: ["D6010"] };
    const basic = { composite_posterior_downgrade: true };
    const major = { waiting_period_months: 6 };
    const flags = deriveActionFlags("active", 15000, 0, 5000, freq(2, 2), mtc, basic, major);
    expect(flags).toContain("missing_tooth_clause");
    expect(flags).toContain("pre_auth_required");
    expect(flags).toContain("frequency_limit");
    expect(flags).toContain("annual_max_low");
    expect(flags).toContain("composite_downgrade");
    expect(flags).toContain("waiting_period_active");
    expect(flags.length).toBe(6);
  });
});

// ── deriveVerificationStatus ────────────────────────────────────────────────

describe("deriveVerificationStatus", () => {
  it('returns "verified" with no flags', () => {
    expect(deriveVerificationStatus("active", [])).toBe("verified");
  });

  it('returns "inactive" for non-active plans', () => {
    expect(deriveVerificationStatus("inactive", [])).toBe("inactive");
    expect(deriveVerificationStatus("unknown", [])).toBe("inactive");
  });

  it('returns "action_required" for any critical flag', () => {
    const criticalFlags = [
      "missing_tooth_clause", "pre_auth_required", "frequency_limit",
      "annual_max_exhausted", "annual_max_low", "composite_downgrade",
      "waiting_period_active",
    ];
    for (const flag of criticalFlags) {
      expect(deriveVerificationStatus("active", [flag])).toBe("action_required");
    }
  });

  it('returns "action_required" when multiple flags present', () => {
    expect(deriveVerificationStatus("active", ["annual_max_low", "composite_downgrade"])).toBe("action_required");
  });
});
