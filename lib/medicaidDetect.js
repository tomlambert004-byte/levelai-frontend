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
// All 50 states covered
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
  // Remaining 29 states
  "77001",   // Alabama Medicaid
  "77002",   // Alaska Medicaid (Denali KidCare)
  "77004",   // Arkansas Medicaid (ARKids First)
  "77006",   // Connecticut HUSKY Health
  "77007",   // Delaware Medicaid (DMMA)
  "77013",   // Hawaii Med-QUEST
  "77014",   // Idaho Medicaid
  "77016",   // Iowa Medicaid (IME)
  "77017",   // Kansas KanCare
  "77018",   // Kentucky Medicaid
  "77019",   // Louisiana Healthy Smiles
  "77020",   // Maine MaineCare
  "77021",   // Maryland Healthy Smiles
  "77022",   // Minnesota Health Care Programs
  "77023",   // Mississippi Medicaid (DOM)
  "77025",   // Montana Medicaid (Smiles for MT)
  "77026",   // Nebraska Heritage Health
  "77042",   // Nevada Medicaid
  "77043",   // New Hampshire Medicaid
  "77044",   // New Mexico Centennial Care
  "77045",   // North Dakota Medicaid
  "77046",   // Oklahoma SoonerCare
  "77047",   // Oregon Health Plan
  "77048",   // Rhode Island RIte Smiles
  "77049",   // South Dakota Medicaid
  "77050",   // Utah Medicaid
  "77051",   // Vermont Green Mountain Care
  "77052",   // West Virginia Medicaid
  "77053",   // Wyoming EqualityCare
]);

// Map insurance name keywords to state codes — all 50 states
const INSURANCE_TO_STATE = {
  "medi-cal":             "CA", "denti-cal":            "CA",
  "soonercare":           "OK", "masshealth":           "MA",
  "badgercare":           "WI", "badgercare plus":      "WI",
  "husky":                "CT", "peach state":          "GA",
  "healthy michigan":     "MI", "nj familycare":        "NJ",
  "apple health":         "WA", "ahcccs":               "AZ",
  "illinicare":           "IL", "buckeye health":       "OH",
  "superior healthplan":  "TX", "texas health steps":   "TX",
  "sunshine health":      "FL", "virginia medicaid":    "VA",
  "cook children":        "TX", "health first colorado":"CO",
  "tenncare":             "TN", "hoosier":              "IN",
  "missouri healthnet":   "MO", "healthy connections":  "SC",
  // Additional state program names
  "alabama medicaid":     "AL", "denali kidcare":       "AK",
  "arkids":               "AR", "arkids first":         "AR",
  "delaware medicaid":    "DE", "dmma":                 "DE",
  "med-quest":            "HI", "medquest":             "HI",
  "idaho medicaid":       "ID", "iowa medicaid":        "IA",
  "kancare":              "KS", "kentucky medicaid":    "KY",
  "healthy smiles":       "LA", "la healthy smiles":    "LA",
  "mainecare":            "ME", "md healthy smiles":    "MD",
  "maryland medicaid":    "MD", "minnesota care":       "MN",
  "mn health care":       "MN", "mississippi medicaid": "MS",
  "montana medicaid":     "MT", "smiles for montana":   "MT",
  "heritage health":      "NE", "nebraska medicaid":    "NE",
  "nevada medicaid":      "NV", "nh medicaid":          "NH",
  "new hampshire medicaid":"NH", "centennial care":     "NM",
  "north carolina medicaid":"NC", "north dakota medicaid":"ND",
  "oregon health plan":   "OR", "ohp":                  "OR",
  "rite smiles":          "RI", "rhode island medicaid":"RI",
  "south dakota medicaid":"SD", "utah medicaid":        "UT",
  "green mountain care":  "VT", "vermont medicaid":     "VT",
  "west virginia medicaid":"WV", "mountaineer":         "WV",
  "equalitycare":         "WY", "wyoming medicaid":     "WY",
};

// Map payer IDs to state codes — all 50 states
const PAYER_TO_STATE = {
  "18916":  "TX",  // OD demo
  "77001":  "AL", "77002":  "AK", "77003":  "AZ", "77004":  "AR",
  "610279": "CA", "77010":  "CO", "77006":  "CT", "77007":  "DE",
  "77034":  "FL", "77012":  "GA", "77013":  "HI", "77014":  "ID",
  "77033":  "IL", "77015":  "IN", "77016":  "IA", "77017":  "KS",
  "77018":  "KY", "77019":  "LA", "77020":  "ME", "77021":  "MD",
  "77029":  "MA", "77030":  "MI", "77022":  "MN", "77023":  "MS",
  "77024":  "MO", "77025":  "MT", "77026":  "NE", "77042":  "NV",
  "77043":  "NH", "77028":  "NJ", "77044":  "NM", "77027":  "NY",
  "77031":  "NC", "77045":  "ND", "77032":  "OH", "77046":  "OK",
  "77047":  "OR", "77036":  "PA", "77048":  "RI", "77035":  "SC",
  "77049":  "SD", "77038":  "TN", "77037":  "TX", "77050":  "UT",
  "77051":  "VT", "77039":  "VA", "77040":  "WA", "77052":  "WV",
  "77041":  "WI", "77053":  "WY",
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
    AL: "Alabama Medicaid",        AK: "Denali KidCare (AK)",
    AZ: "AHCCCS (AZ Medicaid)",    AR: "ARKids First (AR)",
    CA: "Medi-Cal / Denti-Cal",    CO: "Health First Colorado",
    CT: "HUSKY Health (CT)",        DE: "Delaware Medicaid (DMMA)",
    FL: "Florida Medicaid",         GA: "Georgia Medicaid (CMO)",
    HI: "Med-QUEST (HI)",           ID: "Idaho Medicaid",
    IL: "Illinois Medicaid (HFS)",  IN: "Hoosier Healthwise",
    IA: "Iowa Medicaid (IME)",      KS: "KanCare (KS)",
    KY: "Kentucky Medicaid",        LA: "Healthy Smiles (LA)",
    ME: "MaineCare",                MD: "MD Healthy Smiles",
    MA: "MassHealth",               MI: "Healthy Michigan Plan",
    MN: "MN Health Care Programs",  MS: "Mississippi Medicaid",
    MO: "Missouri HealthNet",       MT: "Montana Medicaid (Smiles)",
    NE: "Heritage Health (NE)",     NV: "Nevada Medicaid",
    NH: "NH Medicaid",              NJ: "NJ FamilyCare",
    NM: "Centennial Care (NM)",     NY: "New York Medicaid",
    NC: "NC Medicaid",              ND: "ND Medicaid",
    OH: "Ohio Medicaid",            OK: "SoonerCare (OK)",
    OR: "Oregon Health Plan",       PA: "Pennsylvania Medicaid (MA)",
    RI: "RIte Smiles (RI)",         SC: "SC Healthy Connections",
    SD: "SD Medicaid",              TN: "TennCare Dental",
    TX: "Texas Medicaid (TMHP)",    UT: "Utah Medicaid",
    VT: "Green Mountain Care (VT)", VA: "Virginia Medicaid (DMAS)",
    WA: "Apple Health (WA)",        WV: "WV Medicaid",
    WI: "BadgerCare Plus",          WY: "EqualityCare (WY)",
  };
  return names[(stateCode || "").toUpperCase()] || `${stateCode} Medicaid`;
}
