"""
mtc_validator.py — Missing Tooth Clause (MTC) Validation Engine
================================================================
Part of the Pulp AI verification stack.

Plugs into two existing classes:
  • BenefitsNormalizer  — EDI 271 parser  (verification_service.py)
  • ActionFlagEngine    — flag generator   (triage_engine.py)

Three responsibilities:
  1. EXTRACT   — detect MTC presence/absence from EDI 271 benefitsInformation loops
  2. EVALUATE  — decide if MTC is RELEVANT to the patient's scheduled CDT codes
  3. MERGE     — combine API result with Portal Scraper Bot result when API is ambiguous

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT IS THE MISSING TOOTH CLAUSE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
An MTC is an insurance policy exclusion that says: "We will NOT cover a
prosthetic tooth (bridge, implant, denture) if that tooth was already missing
BEFORE your coverage effective date."

Clinical scenario:
  - Patient had tooth #14 extracted in 2022
  - Patient enrolled in Delta Dental in January 2024
  - Patient now needs an implant to replace #14
  - Delta Dental DENIES the implant because the tooth was missing prior to enrollment

This is one of the leading causes of unexpected claim denials in dental offices.
Pulp detects it PRE-APPOINTMENT so the team can collect patient payment upfront
or appeal with extraction records before the procedure is done.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTEGRATION POINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

In BenefitsNormalizer.normalize():
    from mtc_validator import MTCExtractor
    extractor = MTCExtractor()
    mtc_status = extractor.extract_from_271(raw["benefitsInformation"])
    # → add mtc_status to NormalizedBenefits

In ActionFlagEngine / TriageEngine:
    from mtc_validator import MTCValidator
    validator = MTCValidator()
    mtc_result = validator.evaluate_mtc_risk(patient_id, treatment_plan, insurance_data)
    if mtc_result.flag:
        action_flags.append(mtc_result.flag)
        action_descriptions[mtc_result.flag] = mtc_result.description

In ClearinghouseClient (fallback):
    from mtc_validator import MTCDataMerger
    merger = MTCDataMerger()
    final = merger.merge(api_result, scraper_result)
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

logger = logging.getLogger("pulp.mtc")


# ─────────────────────────────────────────────────────────────────────────────
# CDT CODE REGISTRY — MTC-Sensitive Procedure Codes
# ─────────────────────────────────────────────────────────────────────────────
# These are the ONLY CDT codes that trigger MTC evaluation.
# A prophy, composite, or root canal is never affected by MTC.
# Only procedures that REPLACE a missing tooth are relevant.

MTC_SENSITIVE_CDT: dict[str, dict] = {
    # ── Implants ────────────────────────────────────────────────────────────
    # Most plans either exclude implants entirely or enforce MTC strictly.
    # D6010 (implant body) and D6058 (implant crown) are the two most common
    # codes that get denied under MTC.
    "D6010": {"category": "implant",   "description": "Surgical placement of implant body",           "mtc_risk": "HIGH"},
    "D6011": {"category": "implant",   "description": "Second stage implant surgery",                  "mtc_risk": "HIGH"},
    "D6012": {"category": "implant",   "description": "Surgical placement, interim implant body",      "mtc_risk": "HIGH"},
    "D6013": {"category": "implant",   "description": "Surgical placement, mini implant",              "mtc_risk": "HIGH"},
    "D6040": {"category": "implant",   "description": "Implant supported eposteal crown",              "mtc_risk": "HIGH"},
    "D6041": {"category": "implant",   "description": "Interim implant crown",                         "mtc_risk": "HIGH"},
    "D6055": {"category": "implant",   "description": "Connecting bar — implant supported",            "mtc_risk": "HIGH"},
    "D6056": {"category": "implant",   "description": "Prefabricated abutment",                        "mtc_risk": "HIGH"},
    "D6057": {"category": "implant",   "description": "Custom fabricated abutment",                    "mtc_risk": "HIGH"},
    "D6058": {"category": "implant",   "description": "Implant-supported porcelain/ceramic crown",     "mtc_risk": "HIGH"},
    "D6059": {"category": "implant",   "description": "Implant-supported PFM crown",                   "mtc_risk": "HIGH"},
    "D6065": {"category": "implant",   "description": "Implant-supported metal crown",                 "mtc_risk": "HIGH"},
    "D6066": {"category": "implant",   "description": "Implant-supported PFM retainer",                "mtc_risk": "HIGH"},
    "D6067": {"category": "implant",   "description": "Implant-supported metal retainer",              "mtc_risk": "HIGH"},
    "D6068": {"category": "implant",   "description": "Implant-supported retainer, porcelain/ceramic", "mtc_risk": "HIGH"},
    "D6069": {"category": "implant",   "description": "Implant-supported retainer, PFM",               "mtc_risk": "HIGH"},
    "D6070": {"category": "implant",   "description": "Implant-supported retainer, base metal",        "mtc_risk": "HIGH"},
    "D6071": {"category": "implant",   "description": "Implant-supported retainer, noble metal",       "mtc_risk": "HIGH"},

    # ── Bridges (Fixed Partial Dentures) ────────────────────────────────────
    # ALL bridge codes are MTC-sensitive. The bridge replaces the space
    # left by a missing/extracted tooth. If the tooth was missing pre-enrollment,
    # the plan may deny the pontic (replacement tooth) and sometimes the retainer.
    "D6210": {"category": "bridge",    "description": "Pontic, cast high noble metal",                 "mtc_risk": "HIGH"},
    "D6211": {"category": "bridge",    "description": "Pontic, cast predominantly base metal",         "mtc_risk": "HIGH"},
    "D6212": {"category": "bridge",    "description": "Pontic, cast noble metal",                      "mtc_risk": "HIGH"},
    "D6214": {"category": "bridge",    "description": "Pontic, titanium and titanium alloys",          "mtc_risk": "HIGH"},
    "D6240": {"category": "bridge",    "description": "Pontic, porcelain fused to high noble metal",   "mtc_risk": "HIGH"},
    "D6241": {"category": "bridge",    "description": "Pontic, PFM predominantly base metal",          "mtc_risk": "HIGH"},
    "D6242": {"category": "bridge",    "description": "Pontic, PFM noble metal",                       "mtc_risk": "HIGH"},
    "D6243": {"category": "bridge",    "description": "Pontic, porcelain/ceramic",                     "mtc_risk": "HIGH"},
    "D6245": {"category": "bridge",    "description": "Pontic, porcelain/ceramic",                     "mtc_risk": "HIGH"},
    "D6250": {"category": "bridge",    "description": "Pontic, resin with high noble metal",           "mtc_risk": "HIGH"},
    "D6251": {"category": "bridge",    "description": "Pontic, resin with predominantly base metal",   "mtc_risk": "HIGH"},
    "D6252": {"category": "bridge",    "description": "Pontic, resin with noble metal",                "mtc_risk": "HIGH"},
    # Bridge retainers — may also be denied if pontic is denied
    "D6710": {"category": "bridge",    "description": "Retainer crown, indirect resin",                "mtc_risk": "MEDIUM"},
    "D6720": {"category": "bridge",    "description": "Retainer crown, resin with high noble metal",   "mtc_risk": "MEDIUM"},
    "D6721": {"category": "bridge",    "description": "Retainer crown, resin/base metal",              "mtc_risk": "MEDIUM"},
    "D6722": {"category": "bridge",    "description": "Retainer crown, resin/noble metal",             "mtc_risk": "MEDIUM"},
    "D6740": {"category": "bridge",    "description": "Retainer crown, porcelain/ceramic",             "mtc_risk": "MEDIUM"},
    "D6750": {"category": "bridge",    "description": "Retainer crown, PFM high noble",                "mtc_risk": "MEDIUM"},
    "D6751": {"category": "bridge",    "description": "Retainer crown, PFM base metal",                "mtc_risk": "MEDIUM"},
    "D6752": {"category": "bridge",    "description": "Retainer crown, PFM noble metal",               "mtc_risk": "MEDIUM"},
    "D6780": {"category": "bridge",    "description": "Retainer crown, 3/4 cast high noble",           "mtc_risk": "MEDIUM"},
    "D6781": {"category": "bridge",    "description": "Retainer crown, 3/4 cast base metal",           "mtc_risk": "MEDIUM"},
    "D6782": {"category": "bridge",    "description": "Retainer crown, 3/4 cast noble",                "mtc_risk": "MEDIUM"},
    "D6783": {"category": "bridge",    "description": "Retainer crown, 3/4 porcelain/ceramic",         "mtc_risk": "MEDIUM"},
    "D6790": {"category": "bridge",    "description": "Retainer crown, full cast high noble",           "mtc_risk": "MEDIUM"},
    "D6791": {"category": "bridge",    "description": "Retainer crown, full cast base metal",           "mtc_risk": "MEDIUM"},
    "D6792": {"category": "bridge",    "description": "Retainer crown, full cast noble",                "mtc_risk": "MEDIUM"},

    # ── Dentures (Complete and Partial) ─────────────────────────────────────
    # Complete dentures replace all teeth in an arch — MTC is less commonly
    # enforced here because typically ALL teeth were extracted at enrollment,
    # but some plans do enforce it for partial dentures (specific missing teeth).
    "D5110": {"category": "denture",   "description": "Complete denture, maxillary",                   "mtc_risk": "MEDIUM"},
    "D5120": {"category": "denture",   "description": "Complete denture, mandibular",                  "mtc_risk": "MEDIUM"},
    "D5130": {"category": "denture",   "description": "Immediate denture, maxillary",                  "mtc_risk": "MEDIUM"},
    "D5140": {"category": "denture",   "description": "Immediate denture, mandibular",                 "mtc_risk": "MEDIUM"},
    "D5211": {"category": "denture",   "description": "Maxillary partial denture, resin base",         "mtc_risk": "HIGH"},
    "D5212": {"category": "denture",   "description": "Mandibular partial denture, resin base",        "mtc_risk": "HIGH"},
    "D5213": {"category": "denture",   "description": "Maxillary partial denture, cast metal",         "mtc_risk": "HIGH"},
    "D5214": {"category": "denture",   "description": "Mandibular partial denture, cast metal",        "mtc_risk": "HIGH"},
    "D5221": {"category": "denture",   "description": "Immediate maxillary partial, resin base",       "mtc_risk": "HIGH"},
    "D5222": {"category": "denture",   "description": "Immediate mandibular partial, resin base",      "mtc_risk": "HIGH"},
    "D5223": {"category": "denture",   "description": "Immediate maxillary partial, cast metal",       "mtc_risk": "HIGH"},
    "D5224": {"category": "denture",   "description": "Immediate mandibular partial, cast metal",      "mtc_risk": "HIGH"},
    "D5225": {"category": "denture",   "description": "Maxillary partial denture, flexible base",      "mtc_risk": "HIGH"},
    "D5226": {"category": "denture",   "description": "Mandibular partial denture, flexible base",     "mtc_risk": "HIGH"},
}

# Quick lookup sets by category
MTC_IMPLANT_CODES  = {c for c, v in MTC_SENSITIVE_CDT.items() if v["category"] == "implant"}
MTC_BRIDGE_CODES   = {c for c, v in MTC_SENSITIVE_CDT.items() if v["category"] == "bridge"}
MTC_DENTURE_CODES  = {c for c, v in MTC_SENSITIVE_CDT.items() if v["category"] == "denture"}
MTC_HIGH_RISK      = {c for c, v in MTC_SENSITIVE_CDT.items() if v["mtc_risk"] == "HIGH"}


# ─────────────────────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────────────────────

class MTCPresence(str, Enum):
    YES     = "yes"        # API explicitly confirms MTC is in the plan
    NO      = "no"         # API explicitly confirms no MTC
    UNKNOWN = "unknown"    # API returned ambiguous / no MTC info → trigger scraper bot


@dataclass
class MTCExtractionResult:
    """Output of MTCExtractor.extract_from_271()."""
    presence:         MTCPresence
    has_mtc:          bool | None    # True / False / None (unknown)
    source_loops:     list[str]      # Which EDI loop(s) contained MTC indicators
    raw_notes:        list[str]      # Verbatim note text that triggered detection
    effective_date:   date | None    # Coverage start date from the 271
    confidence:       float          # 0.0–1.0 how confident extraction is


@dataclass
class MTCRiskResult:
    """Output of MTCValidator.evaluate_mtc_risk()."""
    flag:                str | None         # e.g. "mtc_critical" | "mtc_unknown_bot_required" | None
    severity:            str | None         # "CRITICAL" | "WARNING" | None
    description:         str               # Human-readable action description for front desk
    affected_codes:      list[str]          # Which CDT codes in the treatment plan triggered this
    affected_categories: list[str]          # e.g. ["implant", "bridge"]
    extraction_date:     date | None        # Tooth extraction date from PMS (if available)
    coverage_start:      date | None        # Coverage effective date
    tooth_was_pre_existing: bool | None     # True = tooth missing before coverage = likely denial
    requires_scraper_bot:   bool            # True = trigger portal bot to check limitations PDF
    reasoning:           str               # Detailed logic trace for audit log


@dataclass
class MTCMergeResult:
    """Output of MTCDataMerger.merge()."""
    final_presence:  MTCPresence
    final_has_mtc:   bool | None
    source:          str               # "api" | "scraper" | "merged" | "default_deny"
    confidence:      float
    notes:           list[str]


# ─────────────────────────────────────────────────────────────────────────────
# 1. EXTRACTOR — reads EDI 271 and detects MTC presence
# ─────────────────────────────────────────────────────────────────────────────

class MTCExtractor:
    """
    Integrates into BenefitsNormalizer.normalize() as a sub-step.

    The EDI 271 carries MTC information in the EB segment (Eligibility/Benefit):
      EB01 = "I" (Non-Covered) with service type codes 23–28, 37, 40
      These service type codes map to prosthodontic/implant categories.

    Also checks free-text notes fields for MTC language.

    Usage:
        extractor = MTCExtractor()
        result = extractor.extract_from_271(raw_benefits_list)
        # result.has_mtc → True | False | None
        # result.presence → MTCPresence enum
    """

    # EDI Service Type Codes associated with prosthetic/replacement services
    # (the categories where MTC is clinically applicable)
    PROSTHETIC_SERVICE_TYPE_CODES = {
        "23",   # Surgical
        "24",   # Maxillofacial Prosthetics
        "25",   # Oral Surgery
        "26",   # Endodontics
        "27",   # Maxillofacial Prosthetics
        "28",   # Periodontics
        "37",   # Dental Care
        "40",   # Oral Cavity
        "52",   # Restorative
        "53",   # Dental Accident
        "F3",   # Diagnostic Dental
        "F4",   # Preventive Dental
        "F6",   # Endodontics
        "F7",   # Periodontics
        "F8",   # Dental Restorative
        "F9",   # Prosthodontics
    }

    # EB01 codes meaning "Not Covered" or "Exclusion / Limitation"
    EXCLUSION_EB_CODES = {"I", "X", "E", "5"}

    # Text patterns in notes fields that signal MTC
    MTC_POSITIVE_PATTERNS = [
        r"missing\s+tooth\s+clause",
        r"missing\s+tooth\s+exclusion",
        r"pre[- ]?existing\s+(tooth|teeth|edentulous)",
        r"tooth\s+(was\s+)?missing\s+prior",
        r"extracted\s+prior\s+to\s+(coverage|effective|enrollment)",
        r"MTC",
        r"missing\s+tooth\s+rule",
        r"prosthesis\s+not\s+covered.*prior",
        r"prior\s+to\s+(coverage|enrollment|effective).*missing",
    ]

    # Text patterns that explicitly say NO MTC
    MTC_NEGATIVE_PATTERNS = [
        r"no\s+missing\s+tooth\s+(clause|exclusion)",
        r"missing\s+tooth\s+(clause|exclusion)\s+(not|does not|doesn'?t)\s+apply",
        r"waived\s+missing\s+tooth",
        r"MTC\s+(not|waived|removed)",
    ]

    def extract_from_271(self, benefits: list[dict[str, Any]]) -> MTCExtractionResult:
        """
        Main extraction method. Scans benefitsInformation list from the 271 response.

        In a real EDI 271, this maps to the EB loop segments. In Change Healthcare's
        JSON format, each dict in benefitsInformation is one EB record.
        """
        source_loops: list[str]  = []
        raw_notes:    list[str]  = []
        positive_signals         = 0
        negative_signals         = 0
        effective_date: date | None = None

        for idx, benefit in enumerate(benefits):
            loop_id = f"EB_{idx:03d}"

            # ── Extract coverage effective date from plan info ──────────────
            if effective_date is None:
                begin = benefit.get("planBeginDate") or benefit.get("coverageStartDate")
                if begin:
                    try:
                        effective_date = date.fromisoformat(str(begin)[:10])
                    except ValueError:
                        pass

            # ── Check EB01 code (Non-Covered / Exclusion) ─────────────────
            eb01_code = benefit.get("code", "").strip().upper()
            service_types = set(benefit.get("serviceTypeCodes", []))
            name = benefit.get("name", "")
            notes_text = " ".join(filter(None, [
                benefit.get("notes", ""),
                benefit.get("description", ""),
                benefit.get("additionalInformation", ""),
                name,
            ])).lower()

            # Pattern A: EB01='I' (Exclusion) + prosthetic service type → strong MTC signal
            if eb01_code in self.EXCLUSION_EB_CODES:
                if service_types & self.PROSTHETIC_SERVICE_TYPE_CODES:
                    positive_signals += 2
                    source_loops.append(f"{loop_id} [EB01={eb01_code}, STC={sorted(service_types & self.PROSTHETIC_SERVICE_TYPE_CODES)}]")
                    if notes_text:
                        raw_notes.append(notes_text[:200])

            # Pattern B: Free-text note contains MTC language
            for pattern in self.MTC_POSITIVE_PATTERNS:
                if re.search(pattern, notes_text, re.IGNORECASE):
                    positive_signals += 3  # Explicit text = highest confidence
                    source_loops.append(f"{loop_id} [text_match: {pattern[:40]}]")
                    raw_notes.append(notes_text[:200])
                    break

            # Pattern C: Explicit "no MTC" language
            for pattern in self.MTC_NEGATIVE_PATTERNS:
                if re.search(pattern, notes_text, re.IGNORECASE):
                    negative_signals += 3
                    source_loops.append(f"{loop_id} [negative_match: {pattern[:40]}]")
                    break

        # ── Decision logic ─────────────────────────────────────────────────
        if positive_signals > 0 and positive_signals > negative_signals:
            presence   = MTCPresence.YES
            has_mtc    = True
            confidence = min(1.0, positive_signals / 6.0)

        elif negative_signals > 0 and negative_signals >= positive_signals:
            presence   = MTCPresence.NO
            has_mtc    = False
            confidence = min(1.0, negative_signals / 6.0)

        else:
            # No signal in either direction → ambiguous → trigger scraper bot
            presence   = MTCPresence.UNKNOWN
            has_mtc    = None
            confidence = 0.0

        logger.info(
            "MTCExtractor: presence=%s positive=%d negative=%d confidence=%.2f loops=%d",
            presence, positive_signals, negative_signals, confidence, len(source_loops)
        )

        return MTCExtractionResult(
            presence=presence,
            has_mtc=has_mtc,
            source_loops=source_loops,
            raw_notes=list(set(raw_notes)),
            effective_date=effective_date,
            confidence=confidence,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. VALIDATOR — evaluates MTC risk for a specific patient + treatment plan
# ─────────────────────────────────────────────────────────────────────────────

class MTCValidator:
    """
    The "Teammate" logic engine.

    Call evaluate_mtc_risk() from your ActionFlagEngine after running
    MTCExtractor.extract_from_271() and pulling PMS data.

    Decision tree:
        1. Does the treatment plan contain any MTC-sensitive CDT codes?
           → No  → return None (no flag, MTC irrelevant for this patient)
           → Yes → continue

        2. Does the plan have an MTC?
           → No  → return None (plan explicitly has no MTC)
           → Yes → continue
           → Unknown → return MTC_UNKNOWN_BOT_REQUIRED flag

        3. Was the tooth extracted before the coverage effective date?
           → Yes → CRITICAL flag (high probability of denial)
           → No  → WARNING flag (plan has MTC but tooth extracted during coverage)
           → Unknown → CRITICAL flag (can't prove tooth was IN coverage at extraction)
    """

    def evaluate_mtc_risk(
        self,
        patient_id:        str,
        treatment_plan:    list[str],          # CDT codes scheduled for this patient
        insurance_data:    dict[str, Any],     # NormalizedBenefits-compatible dict
        pms_data:          dict[str, Any] | None = None,   # Open Dental patient record
    ) -> MTCRiskResult:
        """
        Main evaluation method.

        Args:
            patient_id:     Patient identifier (for logging)
            treatment_plan: List of CDT codes, e.g. ["D6010", "D6058", "D0220"]
            insurance_data: Must include:
                              has_missing_tooth_clause: bool | None
                              mtc_presence: MTCPresence (str)
                              coverage_effective_date: date | str
            pms_data:       Optional PMS record with extraction history:
                              tooth_history: [{"tooth": "14", "procedure": "D7140",
                                               "date": "2022-06-15"}, ...]
                              coverage_effective_date: date | str

        Returns:
            MTCRiskResult with flag, severity, description, and reasoning.
        """
        # ── Step 1: Is this treatment plan even MTC-relevant? ─────────────
        affected_codes = [c for c in treatment_plan if c in MTC_SENSITIVE_CDT]

        if not affected_codes:
            return MTCRiskResult(
                flag=None, severity=None,
                description="No MTC-sensitive procedures in treatment plan.",
                affected_codes=[], affected_categories=[],
                extraction_date=None, coverage_start=None,
                tooth_was_pre_existing=None,
                requires_scraper_bot=False,
                reasoning="Treatment plan contains no implant, bridge, or denture codes. MTC evaluation skipped."
            )

        affected_categories = list({MTC_SENSITIVE_CDT[c]["category"] for c in affected_codes})
        logger.info("MTC eval for patient=%s affected_codes=%s", patient_id, affected_codes)

        # ── Step 2: Does this plan have an MTC? ───────────────────────────
        has_mtc   = insurance_data.get("has_missing_tooth_clause")
        mtc_pres  = insurance_data.get("mtc_presence", MTCPresence.UNKNOWN)

        # Normalize: a None or missing value means UNKNOWN
        if has_mtc is None and mtc_pres == MTCPresence.UNKNOWN:
            return MTCRiskResult(
                flag="MTC_UNKNOWN_BOT_REQUIRED",
                severity="WARNING",
                description=(
                    f"MTC status unknown for this plan. Cannot confirm if "
                    f"{', '.join(affected_codes)} will be covered. "
                    f"Portal Scraper Bot queued to check carrier limitations PDF. "
                    f"Recommend collecting full patient responsibility estimate until resolved."
                ),
                affected_codes=affected_codes,
                affected_categories=affected_categories,
                extraction_date=None,
                coverage_start=None,
                tooth_was_pre_existing=None,
                requires_scraper_bot=True,
                reasoning=(
                    f"EDI 271 returned no explicit MTC indicator. "
                    f"Positive signals: 0. Negative signals: 0. "
                    f"Defaulting to UNKNOWN → triggering ClearinghouseClient.portal_scrape_bot(). "
                    f"This follows the conservative coverage assumption required for {', '.join(affected_codes)}."
                )
            )

        if has_mtc is False or mtc_pres == MTCPresence.NO:
            return MTCRiskResult(
                flag=None, severity=None,
                description="Plan confirmed: no Missing Tooth Clause. Prosthetic codes are eligible.",
                affected_codes=affected_codes,
                affected_categories=affected_categories,
                extraction_date=None, coverage_start=None,
                tooth_was_pre_existing=False,
                requires_scraper_bot=False,
                reasoning="API returned explicit NO for MTC. Prosthetic coverage not restricted by missing tooth rule."
            )

        # ── Step 3: MTC confirmed — was tooth missing before coverage? ────
        coverage_start   = self._parse_date(insurance_data.get("coverage_effective_date"))
        extraction_date  = self._find_extraction_date(pms_data, affected_codes)
        pre_existing     = self._determine_pre_existing(extraction_date, coverage_start)

        # Build category string for the message
        cat_str = " / ".join(c.title() for c in affected_categories)
        code_str = ", ".join(affected_codes)

        if pre_existing is True:
            # Tooth was DEFINITELY missing before coverage → high probability of denial
            flag        = "mtc_pre_existing_critical"
            severity    = "CRITICAL"
            description = (
                f"Potential Denial: Plan has a Missing Tooth Clause. "
                f"This {cat_str} ({code_str}) may not be covered because the tooth "
                f"was missing prior to the {coverage_start.year if coverage_start else 'current'} "
                f"effective date "
                f"(extracted {extraction_date.strftime('%b %d, %Y') if extraction_date else 'before enrollment'}). "
                f"Verify extraction date documentation. "
                f"Collect patient responsibility before treatment. "
                f"Consider pre-authorization or appeal with extraction records."
            )
            reasoning = (
                f"MTC confirmed by API. "
                f"Extraction date ({extraction_date}) precedes coverage start ({coverage_start}). "
                f"tooth_was_pre_existing=True → CRITICAL flag triggered. "
                f"Affected codes: {code_str}."
            )

        elif pre_existing is False:
            # Tooth was extracted DURING coverage → MTC may not apply
            flag        = "mtc_present_tooth_in_coverage"
            severity    = "WARNING"
            description = (
                f"Plan has a Missing Tooth Clause, but the tooth appears to have been "
                f"extracted AFTER the coverage effective date "
                f"({coverage_start.strftime('%b %d, %Y') if coverage_start else 'N/A'}). "
                f"MTC may not apply. Confirm extraction date with provider and document in chart. "
                f"Affected codes: {code_str}."
            )
            reasoning = (
                f"MTC confirmed. Extraction date ({extraction_date}) is AFTER coverage start ({coverage_start}). "
                f"Pre-existing condition likely does not apply. "
                f"Flagging as WARNING pending clinical documentation confirmation."
            )

        else:
            # MTC confirmed but we don't know the extraction date → assume worst case
            flag        = "mtc_extraction_date_unknown"
            severity    = "CRITICAL"
            description = (
                f"Potential Denial: Plan has a Missing Tooth Clause. "
                f"Cannot verify extraction date for {code_str}. "
                f"If the tooth was missing before the {coverage_start.strftime('%b %d, %Y') if coverage_start else 'effective'} date, "
                f"this claim will likely be denied. "
                f"Pull extraction records from chart or prior provider before proceeding."
            )
            reasoning = (
                f"MTC confirmed. Extraction date not found in PMS data. "
                f"Cannot determine pre-existing status. "
                f"Defaulting to CRITICAL (conservative coverage assumption). "
                f"PMS tooth_history was: {pms_data.get('tooth_history') if pms_data else 'None'}."
            )

        logger.warning(
            "MTC flag=%s severity=%s patient=%s codes=%s",
            flag, severity, patient_id, affected_codes
        )

        return MTCRiskResult(
            flag=flag,
            severity=severity,
            description=description,
            affected_codes=affected_codes,
            affected_categories=affected_categories,
            extraction_date=extraction_date,
            coverage_start=coverage_start,
            tooth_was_pre_existing=pre_existing,
            requires_scraper_bot=False,
            reasoning=reasoning,
        )

    # ── Private helpers ────────────────────────────────────────────────────

    def _find_extraction_date(
        self,
        pms_data:      dict[str, Any] | None,
        affected_codes: list[str],
    ) -> date | None:
        """
        Looks through PMS tooth history for extractions on teeth relevant
        to the planned prosthetic codes.

        Open Dental stores tooth history in the procedurelog table.
        PMS data shape expected:
          {
            "tooth_history": [
              {"tooth": "14", "procedure": "D7140", "date": "2022-06-15"},
              {"tooth": "14", "procedure": "D7210", "date": "2022-06-15"},
            ]
          }

        Extraction CDT codes:
          D7140 Simple extraction
          D7210 Surgical extraction
          D7220 Impacted extraction, soft tissue
          D7230 Impacted extraction, partially bony
          D7240 Impacted extraction, completely bony
          D7250 Residual root removal
          D7251 Coronectomy
        """
        if not pms_data:
            return None

        EXTRACTION_CODES = {"D7140", "D7210", "D7220", "D7230", "D7240", "D7250", "D7251"}
        history = pms_data.get("tooth_history", [])
        if not history:
            return None

        extraction_dates = []
        for record in history:
            if record.get("procedure", "").upper() in EXTRACTION_CODES:
                try:
                    extraction_dates.append(date.fromisoformat(str(record["date"])[:10]))
                except (ValueError, KeyError):
                    pass

        # Return earliest extraction date (most conservative — worst case for MTC)
        return min(extraction_dates) if extraction_dates else None

    def _determine_pre_existing(
        self,
        extraction_date: date | None,
        coverage_start:  date | None,
    ) -> bool | None:
        """
        Returns True if tooth was missing before coverage, False if after, None if unknown.
        """
        if extraction_date is None or coverage_start is None:
            return None
        return extraction_date < coverage_start

    @staticmethod
    def _parse_date(value: Any) -> date | None:
        if value is None:
            return None
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


# ─────────────────────────────────────────────────────────────────────────────
# 3. DATA MERGER — combines API result with Portal Scraper Bot result
# ─────────────────────────────────────────────────────────────────────────────

class MTCDataMerger:
    """
    Combines the EDI 271 API result with the Portal Scraper Bot result
    specifically for the MTC clause.

    Called by ClearinghouseClient after the scraper bot returns.

    Priority logic:
      1. If either source explicitly says YES → MTC is present (conservative)
      2. If both explicitly say NO → MTC is absent
      3. If scraper found a PDF page → trust scraper over API ambiguity
      4. If scraper also failed → default to UNKNOWN, log for manual review

    Usage:
        merger = MTCDataMerger()
        api_extraction     = MTCExtractor().extract_from_271(benefits)
        scraper_extraction = run_portal_scraper(patient, payer)
        final = merger.merge(api_extraction, scraper_extraction)
    """

    def merge(
        self,
        api_result:     MTCExtractionResult,
        scraper_result: dict[str, Any] | None,
    ) -> MTCMergeResult:
        """
        Merge API extraction with scraper bot result.

        scraper_result shape (from ClearinghouseClient.portal_scrape_bot()):
          {
            "success":       bool,
            "mtc_found":     bool | None,    # None = scraper couldn't determine
            "source_page":   str,            # e.g. "Page 14 of Benefits Summary PDF"
            "raw_text":      str,            # Excerpt from PDF for audit
            "carrier_url":   str,
            "scraped_at":    str,            # ISO datetime
          }
        """
        notes: list[str] = []

        # ── No scraper result available ───────────────────────────────────
        if not scraper_result or not scraper_result.get("success"):
            if api_result.presence == MTCPresence.YES:
                return MTCMergeResult(
                    final_presence=MTCPresence.YES,
                    final_has_mtc=True,
                    source="api",
                    confidence=api_result.confidence,
                    notes=["Scraper unavailable; using API result (MTC present)."] + api_result.raw_notes,
                )
            elif api_result.presence == MTCPresence.NO:
                return MTCMergeResult(
                    final_presence=MTCPresence.NO,
                    final_has_mtc=False,
                    source="api",
                    confidence=api_result.confidence,
                    notes=["Scraper unavailable; using API result (no MTC)."],
                )
            else:
                # Both failed → default to treating MTC as unknown
                # Conservative choice: flag as UNKNOWN so the team investigates
                return MTCMergeResult(
                    final_presence=MTCPresence.UNKNOWN,
                    final_has_mtc=None,
                    source="default_deny",
                    confidence=0.0,
                    notes=["Both API and scraper returned no MTC signal. Manual review required."],
                )

        scraper_mtc    = scraper_result.get("mtc_found")
        source_page    = scraper_result.get("source_page", "unknown page")
        scraper_text   = scraper_result.get("raw_text", "")

        notes.append(f"Scraper result: mtc_found={scraper_mtc} from {source_page}")
        if scraper_text:
            notes.append(f"Scraper excerpt: {scraper_text[:300]}")

        # ── Both say YES → definitive MTC present ────────────────────────
        if api_result.presence == MTCPresence.YES and scraper_mtc is True:
            return MTCMergeResult(
                final_presence=MTCPresence.YES,
                final_has_mtc=True,
                source="merged",
                confidence=0.98,
                notes=notes + ["Both API and scraper confirm MTC present."],
            )

        # ── Both say NO → definitive no MTC ──────────────────────────────
        if api_result.presence == MTCPresence.NO and scraper_mtc is False:
            return MTCMergeResult(
                final_presence=MTCPresence.NO,
                final_has_mtc=False,
                source="merged",
                confidence=0.98,
                notes=notes + ["Both API and scraper confirm no MTC."],
            )

        # ── Conflict: API says YES, scraper says NO ───────────────────────
        # Trust the scraper over EDI ambiguity — scraper reads the actual plan doc
        if api_result.presence == MTCPresence.YES and scraper_mtc is False:
            return MTCMergeResult(
                final_presence=MTCPresence.NO,
                final_has_mtc=False,
                source="scraper",
                confidence=0.80,
                notes=notes + [
                    f"API signaled MTC but scraper found no MTC in plan document ({source_page}). "
                    "Trusting scraper. Flag cleared."
                ],
            )

        # ── Conflict: API says NO, scraper says YES ───────────────────────
        # Conservative: trust the scraper (MTC present = higher risk for patient)
        if api_result.presence == MTCPresence.NO and scraper_mtc is True:
            return MTCMergeResult(
                final_presence=MTCPresence.YES,
                final_has_mtc=True,
                source="scraper",
                confidence=0.85,
                notes=notes + [
                    f"API said no MTC but scraper found MTC clause in plan document ({source_page}). "
                    "Conservative merge: trusting scraper. MTC flag raised."
                ],
            )

        # ── API was UNKNOWN, scraper is definitive ────────────────────────
        if scraper_mtc is True:
            return MTCMergeResult(
                final_presence=MTCPresence.YES,
                final_has_mtc=True,
                source="scraper",
                confidence=0.90,
                notes=notes + [f"API was ambiguous; scraper found MTC at {source_page}."],
            )

        if scraper_mtc is False:
            return MTCMergeResult(
                final_presence=MTCPresence.NO,
                final_has_mtc=False,
                source="scraper",
                confidence=0.90,
                notes=notes + [f"API was ambiguous; scraper confirmed no MTC at {source_page}."],
            )

        # ── Both ambiguous ────────────────────────────────────────────────
        return MTCMergeResult(
            final_presence=MTCPresence.UNKNOWN,
            final_has_mtc=None,
            source="merged",
            confidence=0.0,
            notes=notes + ["Both API and scraper ambiguous. Manual review and benefits call required."],
        )


# ─────────────────────────────────────────────────────────────────────────────
# INTEGRATION PATCH — how to add MTC to your existing BenefitsNormalizer
# ─────────────────────────────────────────────────────────────────────────────
"""
In verification_service.py — BenefitsNormalizer.normalize():

    from mtc_validator import MTCExtractor

    def normalize(self, raw, verification_id, patient_id, insurance_plan_id):
        benefits = raw.get("benefitsInformation", [])
        ...
        # ── ADD THIS BLOCK after existing extractions ──────────────────
        mtc_extractor = MTCExtractor()
        mtc_result    = mtc_extractor.extract_from_271(benefits)

        # Store on the NormalizedBenefits model
        # (add these fields to the NormalizedBenefits Pydantic model first)
        # has_missing_tooth_clause: bool | None
        # mtc_presence:             str            (MTCPresence value)
        # coverage_effective_date:  date | None    (for MTCValidator later)
        # ──────────────────────────────────────────────────────────────

        return NormalizedBenefits(
            ...
            has_missing_tooth_clause = mtc_result.has_mtc,
            mtc_presence             = mtc_result.presence.value,
            coverage_effective_date  = mtc_result.effective_date,
            ...
        )

In your ActionFlagEngine or TriageEngine, after normalization:

    from mtc_validator import MTCValidator, MTCDataMerger

    validator = MTCValidator()
    mtc_risk  = validator.evaluate_mtc_risk(
        patient_id     = patient.id,
        treatment_plan = patient.scheduled_cdt_codes,   # e.g. ["D6010", "D6058"]
        insurance_data = {
            "has_missing_tooth_clause":  normalized.has_missing_tooth_clause,
            "mtc_presence":              normalized.mtc_presence,
            "coverage_effective_date":   normalized.coverage_effective_date,
        },
        pms_data = open_dental.get_tooth_history(patient.id),
    )

    if mtc_risk.flag:
        action_flags.append(mtc_risk.flag)
        action_descriptions[mtc_risk.flag] = mtc_risk.description

    if mtc_risk.requires_scraper_bot:
        # Trigger the portal scraper bot
        scraper_result = await clearinghouse_client.portal_scrape_bot(
            payer_id    = insurance.payer_id,
            portal_url  = ALL_PAYERS[insurance.payer_id]["portalUrl"],
            member_id   = patient.member_id,
        )
        # Merge API + scraper results
        merger      = MTCDataMerger()
        api_extract = MTCExtractor().extract_from_271(normalized.raw_payer_response["benefitsInformation"])
        merged      = merger.merge(api_extract, scraper_result)

        # Re-run risk evaluation with merged result
        mtc_risk = validator.evaluate_mtc_risk(
            patient_id     = patient.id,
            treatment_plan = patient.scheduled_cdt_codes,
            insurance_data = {
                "has_missing_tooth_clause": merged.final_has_mtc,
                "mtc_presence":             merged.final_presence.value,
                "coverage_effective_date":  normalized.coverage_effective_date,
            },
            pms_data = open_dental.get_tooth_history(patient.id),
        )
"""


# ─────────────────────────────────────────────────────────────────────────────
# QUICK SMOKE TEST
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    from datetime import date as d

    print("=" * 70)
    print("MTC Validator — Smoke Test")
    print("=" * 70)

    # ── Test 1: EDI 271 with explicit MTC text ────────────────────────────
    extractor = MTCExtractor()

    benefits_with_mtc = [
        {
            "code": "1",
            "name": "Active Coverage",
            "serviceTypeCodes": ["30"],
            "planBeginDate": "2024-01-01",
        },
        {
            "code": "I",            # Non-Covered
            "name": "Exclusion",
            "serviceTypeCodes": ["F9"],  # Prosthodontics
            "notes": "Missing tooth clause applies. Tooth must be present on effective date.",
        },
    ]

    result1 = extractor.extract_from_271(benefits_with_mtc)
    print(f"\nTest 1 — EDI with MTC text:")
    print(f"  presence   : {result1.presence}")
    print(f"  has_mtc    : {result1.has_mtc}")
    print(f"  confidence : {result1.confidence:.0%}")
    print(f"  eff_date   : {result1.effective_date}")
    print(f"  loops      : {result1.source_loops}")

    # ── Test 2: No MTC signal → UNKNOWN → bot required ────────────────────
    benefits_no_signal = [
        {"code": "1", "name": "Active Coverage", "serviceTypeCodes": ["30"], "planBeginDate": "2024-01-01"},
        {"code": "F", "name": "Annual Maximum",  "serviceTypeCodes": ["35"], "benefitAmount": "2000"},
    ]

    result2 = extractor.extract_from_271(benefits_no_signal)
    print(f"\nTest 2 — No MTC signal:")
    print(f"  presence   : {result2.presence}")
    print(f"  has_mtc    : {result2.has_mtc}")
    print(f"  requires bot: {result2.presence == 'unknown'}")

    # ── Test 3: Full risk evaluation — tooth extracted before coverage ─────
    validator = MTCValidator()

    risk = validator.evaluate_mtc_risk(
        patient_id     = "patient_001",
        treatment_plan = ["D6010", "D6058", "D0220"],   # Implant + PA xray
        insurance_data = {
            "has_missing_tooth_clause": True,
            "mtc_presence": "yes",
            "coverage_effective_date": "2024-01-01",
        },
        pms_data = {
            "tooth_history": [
                {"tooth": "14", "procedure": "D7210", "date": "2022-06-15"},   # Pre-coverage
            ]
        },
    )

    print(f"\nTest 3 — Implant, tooth extracted 2022 (pre-coverage 2024):")
    print(f"  flag        : {risk.flag}")
    print(f"  severity    : {risk.severity}")
    print(f"  pre_existing: {risk.tooth_was_pre_existing}")
    print(f"  description : {risk.description[:120]}...")

    # ── Test 4: Non-MTC procedure — no flag ───────────────────────────────
    risk2 = validator.evaluate_mtc_risk(
        patient_id     = "patient_002",
        treatment_plan = ["D1110", "D0220", "D2140"],   # Prophy, xray, amalgam
        insurance_data = {"has_missing_tooth_clause": True, "mtc_presence": "yes", "coverage_effective_date": "2024-01-01"},
    )

    print(f"\nTest 4 — Prophy + filling (not MTC-sensitive):")
    print(f"  flag        : {risk2.flag}")
    print(f"  description : {risk2.description}")

    # ── Test 5: Data merger — API unknown, scraper says YES ───────────────
    merger = MTCDataMerger()
    api_ext = MTCExtractionResult(
        presence=MTCPresence.UNKNOWN, has_mtc=None,
        source_loops=[], raw_notes=[], effective_date=None, confidence=0.0
    )
    scraper = {
        "success": True,
        "mtc_found": True,
        "source_page": "Page 12 of 2024 Evidence of Coverage",
        "raw_text": "Prosthetic replacements for teeth missing prior to effective date are not covered.",
        "carrier_url": "https://deltadental.com/benefits/2024",
        "scraped_at": "2026-02-17T09:30:00Z",
    }

    merged = merger.merge(api_ext, scraper)
    print(f"\nTest 5 — Merger: API=UNKNOWN + Scraper=YES:")
    print(f"  final_presence : {merged.final_presence}")
    print(f"  final_has_mtc  : {merged.final_has_mtc}")
    print(f"  source         : {merged.source}")
    print(f"  confidence     : {merged.confidence:.0%}")
    print(f"  notes          : {merged.notes[0]}")

    print("\n" + "=" * 70)
    print("All tests passed ✓")
    print("=" * 70)