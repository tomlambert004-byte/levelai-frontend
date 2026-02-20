/**
 * Medicaid Patient Detection Utility
 *
 * Detects whether a patient is on Medicaid based on insurance name, payer ID,
 * or plan type. Also attempts to derive the patient's Medicaid state.
 *
 * Used by both server API routes and the client-side UI.
 */

// Common Medicaid program names and managed care organizations
const MEDICAID_KEYWORDS = [
  "medicaid", "medi-cal", "denti-cal", "chip", "healthy families",
  "soonercare", "husky", "masshealth", "badgercare", "peach state",
  "amerihealth caritas", "molina medicaid", "centene", "managed health services",
  "caresource", "wellcare medicaid", "sunshine health", "superior healthplan",
  "unitedhealth community", "anthem medicaid", "aetna better health",
  "buckeye health", "illinicare", "meridian health", "cook children",
  "texas health steps", "healthy michigan", "nj familycare",
  "virginia medicaid", "apple health", "ahcccs", // AZ Medicaid
  "health first colorado", "tenncare", "hoosier healthwise",
  "missouri healthnet", "badgercare plus", "healthy connections",
];

// Known Medicaid payer IDs (state Medicaid fiscal agents + major MCOs)
const MEDICAID_PAYER_IDS = new Set([
  "18916",   // OD demo Medicaid payer ID
  "77037",   // Texas Medicaid (TMHP)
  "610279",  // California Medi-Cal (Denti-Cal)
  "77027",   // New York Medicaid
  "77034",   // Florida Medicaid
  "77036",   // Pennsylvania Medicaid (DHS)
  "77033",   // Illinois Medicaid (HFS)
  "77032",   // Ohio Medicaid
  "77012",   // Georgia Medicaid (DCH)
  "77031",   // North Carolina Medicaid
  "77030",   // Michigan Medicaid (MDHHS)
  "77028",   // New Jersey Medicaid (DMAHS)
  "77039",   // Virginia Medicaid (DMAS)
  "77040",   // Washington Apple Health
  "77003",   // Arizona AHCCCS
  "77029",   // Massachusetts MassHealth
  "77010",   // Colorado Health First Colorado
  "77038",   // Tennessee TennCare
  "77015",   // Indiana Hoosier Healthwise
  "77024",   // Missouri HealthNet
  "77041",   // Wisconsin BadgerCare Plus
  "77035",   // South Carolina Healthy Connections
]);

// Map insurance name keywords to state codes
const INSURANCE_TO_STATE = {
  "medi-cal":           "CA",
  "denti-cal":          "CA",
  "soonercare":         "OK",
  "masshealth":         "MA",
  "badgercare":         "WI",
  "husky":              "CT",
  "peach state":        "GA",
  "healthy michigan":   "MI",
  "nj familycare":      "NJ",
  "apple health":       "WA",
  "ahcccs":             "AZ",
  "illinicare":         "IL",
  "buckeye health":     "OH",
  "superior healthplan":"TX",
  "texas health steps": "TX",
  "sunshine health":    "FL",
  "virginia medicaid":  "VA",
  "cook children":      "TX",
  "health first colorado":"CO",
  "tenncare":             "TN",
  "hoosier":              "IN",
  "missouri healthnet":   "MO",
  "badgercare plus":      "WI",
  "healthy connections":  "SC",
};

// Map payer IDs to state codes
const PAYER_TO_STATE = {
  "18916":  "TX",  // OD demo
  "77037":  "TX",
  "610279": "CA",
  "77027":  "NY",
  "77034":  "FL",
  "77036":  "PA",
  "77033":  "IL",
  "77032":  "OH",
  "77012":  "GA",
  "77031":  "NC",
  "77030":  "MI",
  "77028":  "NJ",
  "77039":  "VA",
  "77040":  "WA",
  "77003":  "AZ",
  "77029":  "MA",
  "77010":  "CO",
  "77038":  "TN",
  "77015":  "IN",
  "77024":  "MO",
  "77041":  "WI",
  "77035":  "SC",
};

/**
 * Detect if a patient is on Medicaid.
 * @param {Object} patient — patient object with insurance/insuranceName and payerId fields
 * @returns {boolean}
 */
export function isMedicaidPatient(patient) {
  if (!patient) return false;

  const insurance = (patient.insurance || patient.insuranceName || "").toLowerCase().trim();
  const payerId = (patient.payerId || "").trim();

  // Check by payer ID first (most reliable)
  if (payerId && MEDICAID_PAYER_IDS.has(payerId)) return true;

  // Check by insurance name keywords
  if (MEDICAID_KEYWORDS.some(kw => insurance.includes(kw))) return true;

  return false;
}

/**
 * Attempt to derive the Medicaid state from patient data.
 * @param {Object} patient — patient object
 * @returns {string|null} — 2-letter state code or null
 */
export function detectMedicaidState(patient) {
  if (!patient) return null;

  const insurance = (patient.insurance || patient.insuranceName || "").toLowerCase().trim();
  const payerId = (patient.payerId || "").trim();

  // Try payer ID mapping first
  if (payerId && PAYER_TO_STATE[payerId]) return PAYER_TO_STATE[payerId];

  // Try insurance name mapping
  for (const [keyword, state] of Object.entries(INSURANCE_TO_STATE)) {
    if (insurance.includes(keyword)) return state;
  }

  // Generic "medicaid" without state info — return null (caller should use practice state)
  return null;
}

/**
 * Get a human-readable Medicaid program name.
 * @param {string} stateCode — 2-letter state code
 * @returns {string}
 */
export function getMedicaidProgramName(stateCode) {
  const names = {
    TX: "Texas Medicaid (TMHP)",
    CA: "Medi-Cal / Denti-Cal",
    NY: "New York Medicaid",
    FL: "Florida Medicaid",
    PA: "Pennsylvania Medicaid (MA)",
    IL: "Illinois Medicaid (HFS)",
    OH: "Ohio Medicaid",
    GA: "Georgia Medicaid (CMO)",
    NC: "NC Medicaid",
    MI: "Healthy Michigan Plan",
    NJ: "NJ FamilyCare",
    VA: "Virginia Medicaid (DMAS)",
    WA: "Apple Health (WA Medicaid)",
    AZ: "AHCCCS (AZ Medicaid)",
    MA: "MassHealth",
    CO: "Health First Colorado",
    TN: "TennCare Dental",
    IN: "Hoosier Healthwise",
    MO: "Missouri HealthNet",
    WI: "BadgerCare Plus",
    SC: "SC Healthy Connections",
  };
  return names[(stateCode || "").toUpperCase()] || `${stateCode} Medicaid`;
}
