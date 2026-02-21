/**
 * Practice Gate — Suspension Check + Feature-Tier Gating
 *
 * Two responsibilities:
 *   1. checkPracticeActive(practice) — blocks suspended/cancelled practices
 *   2. checkFeature(practice, feature) — blocks features not included in the plan tier
 *
 * Usage in route handlers:
 *   const gate = checkPracticeActive(practice);
 *   if (gate) return gate;  // 403 if suspended
 *
 *   const featureGate = checkFeature(practice, "sms");
 *   if (featureGate) return featureGate;  // 403 if feature not in plan
 */

// ── Feature tier definitions ────────────────────────────────────────────────
// Each key maps to a plan tier (Practice.planTier in Prisma).
// Values indicate what's included at that tier.
const FEATURE_TIERS = {
  starter: {
    verification:   true,   // core product — always on
    aiChat:         true,   // Payer Pal basic (capped)
    aiChatLimit:    500,    // per month
    preAuth:        true,   // pre-auth letter generation
    preAuthLimit:   100,    // per month
    autoFax:        true,   // auto-fax cover sheets
    sms:            false,  // patient SMS outreach
    writeback:      false,  // PMS writeback
    multiLocation:  false,  // multi-practice management
  },
  professional: {
    verification:   true,
    aiChat:         true,
    aiChatLimit:    Infinity,
    preAuth:        true,
    preAuthLimit:   Infinity,
    autoFax:        true,
    sms:            true,
    writeback:      true,
    multiLocation:  false,
  },
  enterprise: {
    verification:   true,
    aiChat:         true,
    aiChatLimit:    Infinity,
    preAuth:        true,
    preAuthLimit:   Infinity,
    autoFax:        true,
    sms:            true,
    writeback:      true,
    multiLocation:  true,
  },
};

// Sandbox gets Professional-level features for demo purposes
const SANDBOX_FEATURES = { ...FEATURE_TIERS.professional };

// Human-readable upgrade messages per feature
const UPGRADE_MESSAGES = {
  sms:            "Patient SMS outreach requires the Professional plan.",
  writeback:      "PMS writeback requires the Professional plan.",
  multiLocation:  "Multi-location management requires the Enterprise plan.",
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns a 403 Response if the practice is not active, or null if OK.
 * Accepts the practice object (from prisma.practice.findUnique).
 *
 * - null practice → allow (new user, not yet onboarded)
 * - status "active" or missing → allow
 * - status "suspended" | "cancelled" → block with error_type
 */
export function checkPracticeActive(practice) {
  if (!practice) return null; // new user, not yet onboarded — allow
  const status = practice.status || "active";
  if (status === "active") return null;

  return Response.json({
    error: "Service paused",
    error_type: "practice_suspended",
    message: "Your LvlAI subscription is currently paused. Please contact support to resume service.",
  }, { status: 403 });
}

/**
 * Returns the features object for a practice based on its planTier.
 * Returns sandbox features if practice is null or in sandbox mode.
 *
 * @param {object|null} practice — from prisma.practice.findUnique
 * @returns {{ tier: string, features: object }}
 */
export function getPracticeFeatures(practice) {
  if (!practice || practice.accountMode === "sandbox") {
    return { tier: "sandbox", features: SANDBOX_FEATURES };
  }
  const tier = (practice.planTier || "starter").toLowerCase();
  return {
    tier,
    features: FEATURE_TIERS[tier] || FEATURE_TIERS.starter,
  };
}

/**
 * Returns a 403 Response if the feature is not available in the practice's
 * plan tier. Returns null if the feature is allowed.
 *
 * Usage:
 *   const gate = checkFeature(practice, "sms");
 *   if (gate) return gate;
 *
 * @param {object|null} practice
 * @param {string} feature — key from FEATURE_TIERS (e.g. "sms", "writeback")
 * @returns {Response|null}
 */
export function checkFeature(practice, feature) {
  const { tier, features } = getPracticeFeatures(practice);
  if (features[feature]) return null; // feature allowed

  return Response.json({
    error: "Feature not available",
    error_type: "feature_gated",
    feature,
    currentTier: tier,
    message: UPGRADE_MESSAGES[feature] || `This feature requires a higher plan. You are on the ${tier} plan.`,
  }, { status: 403 });
}

/** Export tier definitions for admin/status endpoints */
export { FEATURE_TIERS };
