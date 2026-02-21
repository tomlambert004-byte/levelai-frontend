/**
 * Practice Gate Tests — Feature Tier Gating
 *
 * Tests checkPracticeActive(), checkFeature(), and getPracticeFeatures()
 * to ensure plan-based feature gating works correctly.
 */
import { describe, it, expect } from "vitest";
import { checkPracticeActive, checkFeature, getPracticeFeatures, FEATURE_TIERS } from "../lib/practiceGate.js";

// ── Mock practice objects ───────────────────────────────────────────────────
const activePractice = (tier = "starter") => ({
  status: "active",
  accountMode: "live",
  planTier: tier,
});

const sandboxPractice = () => ({
  status: "active",
  accountMode: "sandbox",
  planTier: "starter",
});

const suspendedPractice = () => ({
  status: "suspended",
  accountMode: "live",
  planTier: "professional",
});

// ── checkPracticeActive ─────────────────────────────────────────────────────

describe("checkPracticeActive", () => {
  it("returns null for active practice", () => {
    expect(checkPracticeActive(activePractice())).toBeNull();
  });

  it("returns null for null practice (new user)", () => {
    expect(checkPracticeActive(null)).toBeNull();
  });

  it("returns 403 Response for suspended practice", () => {
    const gate = checkPracticeActive(suspendedPractice());
    expect(gate).not.toBeNull();
    expect(gate.status).toBe(403);
  });

  it("returns null when status is missing (defaults to active)", () => {
    expect(checkPracticeActive({ accountMode: "live" })).toBeNull();
  });
});

// ── getPracticeFeatures ─────────────────────────────────────────────────────

describe("getPracticeFeatures", () => {
  it("returns starter features for starter plan", () => {
    const { tier, features } = getPracticeFeatures(activePractice("starter"));
    expect(tier).toBe("starter");
    expect(features.verification).toBe(true);
    expect(features.sms).toBe(false);
    expect(features.writeback).toBe(false);
  });

  it("returns professional features for professional plan", () => {
    const { tier, features } = getPracticeFeatures(activePractice("professional"));
    expect(tier).toBe("professional");
    expect(features.sms).toBe(true);
    expect(features.writeback).toBe(true);
    expect(features.multiLocation).toBe(false);
  });

  it("returns enterprise features for enterprise plan", () => {
    const { tier, features } = getPracticeFeatures(activePractice("enterprise"));
    expect(tier).toBe("enterprise");
    expect(features.multiLocation).toBe(true);
  });

  it("returns sandbox features (professional-level) for sandbox mode", () => {
    const { tier, features } = getPracticeFeatures(sandboxPractice());
    expect(tier).toBe("sandbox");
    expect(features.sms).toBe(true); // sandbox gets full features for demo
    expect(features.writeback).toBe(true);
  });

  it("returns sandbox features for null practice", () => {
    const { tier, features } = getPracticeFeatures(null);
    expect(tier).toBe("sandbox");
    expect(features.verification).toBe(true);
  });

  it("defaults to starter for unknown tier", () => {
    const { tier, features } = getPracticeFeatures(activePractice("unknown_tier"));
    expect(tier).toBe("unknown_tier");
    expect(features.sms).toBe(false); // falls back to starter features
  });
});

// ── checkFeature ────────────────────────────────────────────────────────────

describe("checkFeature", () => {
  it("returns null when feature is available", () => {
    expect(checkFeature(activePractice("professional"), "sms")).toBeNull();
  });

  it("returns 403 when feature is not available", () => {
    const gate = checkFeature(activePractice("starter"), "sms");
    expect(gate).not.toBeNull();
    expect(gate.status).toBe(403);
  });

  it("allows all features in sandbox mode", () => {
    expect(checkFeature(sandboxPractice(), "sms")).toBeNull();
    expect(checkFeature(sandboxPractice(), "writeback")).toBeNull();
  });

  it("returns null for null practice (sandbox)", () => {
    expect(checkFeature(null, "sms")).toBeNull();
  });

  it("blocks multiLocation for professional plan", () => {
    const gate = checkFeature(activePractice("professional"), "multiLocation");
    expect(gate).not.toBeNull();
    expect(gate.status).toBe(403);
  });

  it("allows multiLocation for enterprise plan", () => {
    expect(checkFeature(activePractice("enterprise"), "multiLocation")).toBeNull();
  });
});

// ── Tier definition sanity checks ───────────────────────────────────────────

describe("FEATURE_TIERS", () => {
  it("has all three tiers defined", () => {
    expect(FEATURE_TIERS).toHaveProperty("starter");
    expect(FEATURE_TIERS).toHaveProperty("professional");
    expect(FEATURE_TIERS).toHaveProperty("enterprise");
  });

  it("all tiers include verification", () => {
    for (const tier of Object.values(FEATURE_TIERS)) {
      expect(tier.verification).toBe(true);
    }
  });

  it("enterprise is a superset of professional", () => {
    const pro = FEATURE_TIERS.professional;
    const ent = FEATURE_TIERS.enterprise;
    for (const [key, value] of Object.entries(pro)) {
      if (typeof value === "boolean" && value === true) {
        expect(ent[key]).toBe(true);
      }
    }
  });
});
