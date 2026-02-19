"""
╔══════════════════════════════════════════════════════════════════════════════╗
║           PULP — DATA INTEGRITY MANAGER & FALLBACK ORCHESTRATOR            ║
║                                                                              ║
║  Handles incomplete Vyne / Onederful API responses by:                       ║
║    1. Evaluating data completeness against a criticality-ranked field list   ║
║    2. Triaging missing fields into CRITICAL / IMPORTANT / NICE_TO_HAVE       ║
║    3. Dispatching secondary retrieval jobs (RPA scrape or PDF analysis)      ║
║    4. Merging partial API data + secondary data into one Smart Breakdown     ║
║    5. Generating human-readable audit trails for every decision              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import json
import uuid
import logging
from copy import deepcopy
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pulp.integrity")


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — ENUMERATIONS & CONSTANTS
# ══════════════════════════════════════════════════════════════════════════════

class Criticality(str, Enum):
    """
    Priority rank for a missing data field.

    CRITICAL     → Directly impacts treatment planning or patient cost.
                   A missing value here means we CANNOT produce a reliable
                   estimate — secondary retrieval is mandatory before the
                   appointment proceeds.

    IMPORTANT    → Affects accuracy of the cost breakdown but we can still
                   proceed with a conservative estimate + flagged caveat.
                   Secondary retrieval is attempted but appointment is not
                   blocked.

    NICE_TO_HAVE → Supplementary detail (e.g., waiting period on a procedure
                   not scheduled today). Log it, attempt retrieval if cheap,
                   but never block.
    """
    CRITICAL     = "CRITICAL"
    IMPORTANT    = "IMPORTANT"
    NICE_TO_HAVE = "NICE_TO_HAVE"


class RetrievalMethod(str, Enum):
    """
    Which secondary retrieval service should be dispatched.

    RPA_SCRAPE   → Robotic Process Automation bot logs into the carrier portal
                   and screen-scrapes the exact field. Best for structured
                   carrier portals (Delta, Cigna, Aetna).

    PDF_ANALYSIS → AI reads the patient's Explanation of Benefits (EOB) or
                   Summary Plan Description PDF. Best for MetLife, Guardian,
                   United Concordia who email PDFs.

    MANUAL_CALL  → Last resort. Generates a pre-filled call script for staff.
                   Used only when RPA and PDF both unavailable.
    """
    RPA_SCRAPE   = "RPA_SCRAPE"
    PDF_ANALYSIS = "PDF_ANALYSIS"
    MANUAL_CALL  = "MANUAL_CALL"


class MergeSource(str, Enum):
    """Tracks provenance of every field in the Smart Breakdown."""
    API          = "api"           # Came directly from clearinghouse API
    RPA          = "rpa_scrape"    # Filled in by RPA bot
    PDF          = "pdf_analysis"  # Filled in by AI PDF reader
    MANUAL       = "manual_entry"  # Staff entered manually
    INFERRED     = "inferred"      # Calculated / estimated from other fields
    MISSING      = "missing"       # Still absent after all retrieval attempts


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — FIELD CRITICALITY REGISTRY
# ══════════════════════════════════════════════════════════════════════════════

# Each entry defines:
#   field_path   : dot-notation path into the insurance JSON
#   criticality  : how urgently we need it
#   procedures   : which CDT code categories it matters for ("*" = always)
#   preferred_retrieval : which secondary service is most likely to have it
#   fallback_retrieval  : if preferred is unavailable
#   description  : human-readable label for logs / UI
#
# ─── IF/THEN LOGIC EXPLANATION ────────────────────────────────────────────────
# The criticality ranking is built around these dental business rules:
#
#  CRITICAL fields
#  ───────────────
#  • annual_maximum_remaining  → Without this we cannot tell if insurance will
#    pay anything. A patient expecting 80% coverage on a $1,500 crown gets a
#    $1,200 surprise if the max is already hit. Affects ALL procedures.
#
#  • individual_deductible / deductible_met → Directly changes patient's
#    out-of-pocket math for ALL restorative/major services. A $50 remaining
#    deductible on a $300 filling is material.
#
#  • frequency_limit.D2740 (PFM Crown) → Crowns are the highest-fee single
#    procedure in general dentistry. If a crown was done on tooth #30 in 2023
#    and the plan allows 1 per tooth per 5 years, billing another crown in
#    2025 will be a full denial. CRITICAL.
#
#  • frequency_limit.D4341 (Perio SRP) → SRP is frequently scheduled as
#    4 quads / 2 visits. Frequency limits here cause partial denials that
#    create unexpected patient balances. CRITICAL.
#
#  • missing_tooth_clause → If the tooth being restored/replaced was extracted
#    before the plan's effective date, the entire prosthetic claim is denied.
#    CRITICAL for implants, bridges, partials.
#
#  IMPORTANT fields
#  ────────────────
#  • frequency_limit.D1110 (Adult prophy) → Most plans allow 2x/year.
#    A missed frequency check causes a $120–180 denial. Important but the
#    patient can reschedule; appointment doesn't need to be blocked.
#
#  • frequency_limit.D0274 (4 BWX) → Bitewing frequency limits cause ~$80–120
#    denials. Important to flag; staff can decide whether to postpone x-rays.
#
#  • waiting_period.major → New patients on a plan < 12 months may have
#    no coverage on crowns/bridges. Important to flag even if crown CDT
#    frequency data is present.
#
#  • composite_posterior_downgrade → Changes reimbursement math by ~$50–100
#    per tooth. Important for accuracy but doesn't block care.
#
#  NICE_TO_HAVE fields
#  ───────────────────
#  • frequency_limit.D1351 (Sealants) → Low fee, age-limited, rarely the
#    primary procedure. Nice to have but low financial impact.
#
#  • ortho_lifetime_maximum → Only relevant if ortho is on today's schedule.
#    Collecting it proactively is useful but not urgent for most visits.
#
#  • fluoride_coverage → Typically $0–40 fee item. Flag if missing but
#    do not spend RPA credits retrieving it.

FIELD_REGISTRY: list[dict] = [
    # ── CRITICAL ──────────────────────────────────────────────────────────────
    {
        "field_path": "annual_maximum_remaining",
        "criticality": Criticality.CRITICAL,
        "procedures": ["*"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Annual Maximum Remaining",
    },
    {
        "field_path": "individual_deductible",
        "criticality": Criticality.CRITICAL,
        "procedures": ["*"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Individual Deductible (Total)",
    },
    {
        "field_path": "deductible_met",
        "criticality": Criticality.CRITICAL,
        "procedures": ["*"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Deductible Met Year-to-Date",
    },
    {
        "field_path": "frequency_limits.D2740",
        "criticality": Criticality.CRITICAL,
        "procedures": ["crown", "D2740", "D2750", "D2751", "D2752"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Crown Frequency Limit (D2740 — PFM Crown)",
    },
    {
        "field_path": "frequency_limits.D4341",
        "criticality": Criticality.CRITICAL,
        "procedures": ["perio", "SRP", "D4341", "D4342"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Perio SRP Frequency Limit (D4341)",
    },
    {
        "field_path": "missing_tooth_clause",
        "criticality": Criticality.CRITICAL,
        "procedures": ["implant", "bridge", "partial", "D6010", "D6240", "D5211"],
        "preferred_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "fallback_retrieval": RetrievalMethod.MANUAL_CALL,
        "description": "Missing Tooth Clause (prosthetic / implant exclusion)",
    },
    # ── IMPORTANT ─────────────────────────────────────────────────────────────
    {
        "field_path": "frequency_limits.D1110",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["prophy", "cleaning", "D1110", "D1120"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Adult Prophy Frequency (D1110)",
    },
    {
        "field_path": "frequency_limits.D0274",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["bitewing", "BWX", "D0274", "D0272"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Bitewing X-Ray Frequency (D0274 — 4 BWX)",
    },
    {
        "field_path": "waiting_period.major",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["crown", "bridge", "D2740", "D2750", "D6240"],
        "preferred_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "fallback_retrieval": RetrievalMethod.MANUAL_CALL,
        "description": "Waiting Period — Major Services",
    },
    {
        "field_path": "composite_posterior_downgrade",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["composite", "D2330", "D2331", "D2332", "D2335"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Posterior Composite Downgrade to Amalgam Rate",
    },
    {
        "field_path": "frequency_limits.D4910",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["perio maintenance", "D4910"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Perio Maintenance Frequency (D4910)",
    },
    {
        "field_path": "coverage_pct.basic",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["*"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Basic / Restorative Coverage Percentage",
    },
    {
        "field_path": "coverage_pct.major",
        "criticality": Criticality.IMPORTANT,
        "procedures": ["crown", "bridge", "D2740", "D6240"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Major Services Coverage Percentage",
    },
    # ── NICE TO HAVE ──────────────────────────────────────────────────────────
    {
        "field_path": "frequency_limits.D1351",
        "criticality": Criticality.NICE_TO_HAVE,
        "procedures": ["sealant", "D1351"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Sealant Frequency / Age Limit (D1351)",
    },
    {
        "field_path": "ortho_lifetime_maximum",
        "criticality": Criticality.NICE_TO_HAVE,
        "procedures": ["ortho", "D8080", "D8090"],
        "preferred_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "fallback_retrieval": RetrievalMethod.MANUAL_CALL,
        "description": "Orthodontic Lifetime Maximum",
    },
    {
        "field_path": "fluoride_coverage",
        "criticality": Criticality.NICE_TO_HAVE,
        "procedures": ["fluoride", "D1206", "D1208"],
        "preferred_retrieval": RetrievalMethod.RPA_SCRAPE,
        "fallback_retrieval": RetrievalMethod.PDF_ANALYSIS,
        "description": "Fluoride Coverage",
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — DATA STRUCTURES
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class MissingField:
    """Represents one field that is absent / null in the API response."""
    field_path: str
    description: str
    criticality: Criticality
    preferred_retrieval: RetrievalMethod
    fallback_retrieval: RetrievalMethod
    relevant_to_today: bool   # True if the patient's scheduled procedure needs this field


@dataclass
class RetrievalJob:
    """
    A dispatch ticket sent to the secondary retrieval service.
    In production this would be serialised to a message queue (SQS / Redis).
    """
    job_id: str
    patient_id: str
    carrier: str
    member_id: str
    method: RetrievalMethod
    fields_requested: list[str]        # field_paths to fill in
    criticality: Criticality           # highest criticality among requested fields
    created_at: str
    status: str = "PENDING"            # PENDING | IN_PROGRESS | COMPLETE | FAILED
    result: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class IntegrityReport:
    """Full output of the Data Integrity Manager for one patient record."""
    patient_id: str
    carrier: str
    member_id: str
    evaluated_at: str
    completeness_score: float          # 0.0 – 1.0
    completeness_grade: str            # A / B / C / D / F
    critical_missing: list[MissingField]
    important_missing: list[MissingField]
    nice_to_have_missing: list[MissingField]
    retrieval_jobs: list[RetrievalJob]
    block_appointment: bool            # True if any CRITICAL field is missing
    audit_trail: list[str]             # Timestamped reasoning log


@dataclass
class SmartBreakdown:
    """
    The final merged output shown to the user / stored in the PMS.
    Every field carries its source so the UI can show provenance icons.
    """
    patient_id: str
    carrier: str
    member_id: str
    completed_at: str
    completeness_score: float
    completeness_grade: str
    fields: dict[str, Any]            # field_path → resolved value (or None)
    sources: dict[str, MergeSource]   # field_path → where the value came from
    human_note: str                    # AI-generated chart note
    warnings: list[str]               # Remaining unknowns that affect estimates
    audit_trail: list[str]


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — UTILITY HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_missing(value: Any) -> bool:
    """
    Treat a value as 'missing' if it is:
      - None / null
      - The string literals "Not Found", "N/A", "unknown", "" (case-insensitive)
      - An empty dict or empty list
    """
    if value is None:
        return True
    if isinstance(value, str) and value.strip().lower() in {
        "", "not found", "n/a", "unknown", "null", "none", "not applicable",
        "information not available", "not covered", "see plan documents",
    }:
        return True
    if isinstance(value, (dict, list)) and len(value) == 0:
        return True
    return False


def _get_nested(data: dict, dot_path: str) -> Any:
    """Safely traverse a dict using dot-notation: 'frequency_limits.D2740'"""
    parts = dot_path.split(".")
    node = data
    for part in parts:
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def _set_nested(data: dict, dot_path: str, value: Any) -> None:
    """Write a value into a dict at a dot-notation path, creating dicts as needed."""
    parts = dot_path.split(".")
    node = data
    for part in parts[:-1]:
        if part not in node or not isinstance(node[part], dict):
            node[part] = {}
        node = node[part]
    node[parts[-1]] = value


def _procedure_is_relevant(scheduled_procedures: list[str], field_procedures: list[str]) -> bool:
    """
    Returns True if the field is relevant to at least one of today's scheduled
    procedures.  Uses simple substring matching so 'crown' matches 'Crown Prep #14'.
    """
    if "*" in field_procedures:
        return True
    for scheduled in scheduled_procedures:
        sched_lower = scheduled.lower()
        for fp in field_procedures:
            if fp.lower() in sched_lower or sched_lower in fp.lower():
                return True
    return False


def _grade(score: float) -> str:
    """Convert a 0–1 completeness score to a letter grade."""
    if score >= 0.95: return "A"
    if score >= 0.85: return "B"
    if score >= 0.70: return "C"
    if score >= 0.50: return "D"
    return "F"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — DATA INTEGRITY EVALUATOR
# ══════════════════════════════════════════════════════════════════════════════

def evaluate_integrity(
    api_response: dict,
    scheduled_procedures: list[str],
    patient_id: str,
    carrier: str,
    member_id: str,
) -> IntegrityReport:
    """
    Evaluates an incoming clearinghouse JSON response for completeness.

    Parameters
    ----------
    api_response          : Raw JSON dict from Vyne / Onederful
    scheduled_procedures  : List of procedure descriptions for today's appointment
                            e.g. ["Crown Prep #14", "BWX D0274"]
    patient_id            : Internal patient identifier
    carrier               : Carrier name (for RPA bot routing)
    member_id             : Member ID (for RPA bot login)

    Returns
    -------
    IntegrityReport with all missing fields categorised and retrieval jobs
    queued.
    """
    audit: list[str] = []
    critical_missing:      list[MissingField] = []
    important_missing:     list[MissingField] = []
    nice_missing:          list[MissingField] = []

    def note(msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        audit.append(f"[{ts}] {msg}")
        log.info(msg)

    note(f"BEGIN integrity evaluation — patient {patient_id} | carrier: {carrier}")
    note(f"Scheduled procedures: {scheduled_procedures}")

    total_fields = len(FIELD_REGISTRY)
    fields_present = 0

    for reg in FIELD_REGISTRY:
        path        = reg["field_path"]
        criticality = reg["criticality"]
        relevant    = _procedure_is_relevant(scheduled_procedures, reg["procedures"])
        value       = _get_nested(api_response, path)
        missing     = _is_missing(value)

        if not missing:
            fields_present += 1
            note(f"  ✓  {path} — present ({criticality.value})")
            continue

        mf = MissingField(
            field_path=path,
            description=reg["description"],
            criticality=criticality,
            preferred_retrieval=reg["preferred_retrieval"],
            fallback_retrieval=reg["fallback_retrieval"],
            relevant_to_today=relevant,
        )

        if criticality == Criticality.CRITICAL:
            critical_missing.append(mf)
            flag = "🚨 CRITICAL" if relevant else "⚠  CRITICAL (not today's procedure)"
            note(f"  {flag}  {path} — MISSING")
        elif criticality == Criticality.IMPORTANT:
            important_missing.append(mf)
            flag = "⚠  IMPORTANT" if relevant else "ℹ  IMPORTANT (not today)"
            note(f"  {flag}  {path} — MISSING")
        else:
            nice_missing.append(mf)
            note(f"  ℹ  NICE_TO_HAVE  {path} — MISSING")

    completeness = fields_present / total_fields
    grade = _grade(completeness)
    block = any(mf.relevant_to_today for mf in critical_missing)

    note(f"Completeness: {completeness:.0%} ({grade})")
    note(f"Missing — CRITICAL: {len(critical_missing)}, IMPORTANT: {len(important_missing)}, NICE_TO_HAVE: {len(nice_missing)}")
    note(f"Block appointment: {block}")

    # Build retrieval jobs
    jobs = _build_retrieval_jobs(
        critical_missing + important_missing + nice_missing,
        patient_id, carrier, member_id, audit
    )

    return IntegrityReport(
        patient_id=patient_id,
        carrier=carrier,
        member_id=member_id,
        evaluated_at=_now_iso(),
        completeness_score=completeness,
        completeness_grade=grade,
        critical_missing=critical_missing,
        important_missing=important_missing,
        nice_to_have_missing=nice_missing,
        retrieval_jobs=jobs,
        block_appointment=block,
        audit_trail=audit,
    )


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — RETRIEVAL JOB BUILDER
# ══════════════════════════════════════════════════════════════════════════════

def _build_retrieval_jobs(
    missing_fields: list[MissingField],
    patient_id: str,
    carrier: str,
    member_id: str,
    audit: list[str],
) -> list[RetrievalJob]:
    """
    Groups missing fields by their preferred retrieval method and creates
    one job per method (batching reduces round-trips to carrier portals).

    Dispatch priority:
      1. RPA_SCRAPE jobs for CRITICAL fields run first.
      2. PDF_ANALYSIS jobs are dispatched in parallel.
      3. MANUAL_CALL jobs are only created if no automated method can cover
         the field (e.g., missing_tooth_clause with no PDF available).

    Returns a list of RetrievalJob objects ready to be enqueued.
    """
    # Skip NICE_TO_HAVE fields that are not relevant to today's visit
    fields_to_retrieve = [
        mf for mf in missing_fields
        if mf.criticality != Criticality.NICE_TO_HAVE or mf.relevant_to_today
    ]

    # Group by preferred retrieval method
    groups: dict[RetrievalMethod, list[MissingField]] = {}
    for mf in fields_to_retrieve:
        groups.setdefault(mf.preferred_retrieval, []).append(mf)

    jobs: list[RetrievalJob] = []

    # Ordering: CRITICAL RPA first, then CRITICAL PDF, then IMPORTANT, etc.
    method_order = [RetrievalMethod.RPA_SCRAPE, RetrievalMethod.PDF_ANALYSIS, RetrievalMethod.MANUAL_CALL]

    for method in method_order:
        batch = groups.get(method, [])
        if not batch:
            continue

        # Highest criticality in this batch
        top_crit = Criticality.NICE_TO_HAVE
        for mf in batch:
            if mf.criticality == Criticality.CRITICAL:
                top_crit = Criticality.CRITICAL
                break
            if mf.criticality == Criticality.IMPORTANT:
                top_crit = Criticality.IMPORTANT

        job = RetrievalJob(
            job_id=str(uuid.uuid4()),
            patient_id=patient_id,
            carrier=carrier,
            member_id=member_id,
            method=method,
            fields_requested=[mf.field_path for mf in batch],
            criticality=top_crit,
            created_at=_now_iso(),
        )
        jobs.append(job)
        audit.append(
            f"[{datetime.now().strftime('%H:%M:%S')}] "
            f"DISPATCH {method.value} job {job.job_id[:8]}… — "
            f"{len(batch)} fields — top criticality: {top_crit.value}"
        )
        log.info(
            "DISPATCH %s | job=%s | fields=%s | criticality=%s",
            method.value, job.job_id[:8], [mf.field_path for mf in batch], top_crit.value,
        )

    return jobs


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — SECONDARY RETRIEVAL STUBS
# ══════════════════════════════════════════════════════════════════════════════
# In production these would be real integrations:
#   RPA_SCRAPE   → Selenium / Playwright script or an RPA platform (UIPath, AA)
#   PDF_ANALYSIS → AWS Textract + Claude or GPT-4o Vision parsing an EOB PDF
#
# The stubs below simulate the contract: they accept a RetrievalJob and return
# a dict of { field_path: value } for every field they successfully retrieved.

def rpa_scrape_stub(job: RetrievalJob) -> dict[str, Any]:
    """
    Stub for RPA carrier portal scraper.

    Production implementation would:
      1. Look up carrier in a routing table → portal URL + login credentials
      2. Launch headless browser session
      3. Navigate to member eligibility page using job.member_id
      4. Extract each field in job.fields_requested
      5. Return structured dict

    Carriers with known portal support: Delta Dental, Cigna, Aetna, MetLife,
    Guardian, United Concordia, Humana, Ameritas.
    """
    log.info("RPA_SCRAPE stub executing for job %s | carrier: %s", job.job_id[:8], job.carrier)

    # Simulated results — replace with real portal scraping logic
    simulated_data: dict[str, Any] = {
        "annual_maximum_remaining": 145000,           # cents
        "individual_deductible":    5000,             # cents
        "deductible_met":           5000,             # cents
        "frequency_limits.D1110": {
            "times_per_period": 2,
            "period": "calendar_year",
            "used_this_period": 1,
            "next_eligible_date": "2025-07-10",
        },
        "frequency_limits.D0274": {
            "times_per_period": 1,
            "period": "calendar_year",
            "used_this_period": 0,
            "next_eligible_date": None,
        },
        "frequency_limits.D2740": {
            "times_per_period": 1,
            "period": "5_years",
            "last_service_date": None,
            "next_eligible_date": None,
        },
        "frequency_limits.D4341": {
            "quads_per_year": 4,
            "used_this_year": 0,
            "last_service_date": None,
        },
        "composite_posterior_downgrade": False,
        "coverage_pct.basic": 80,
        "coverage_pct.major": 50,
    }

    result = {k: simulated_data[k] for k in job.fields_requested if k in simulated_data}
    missing = [k for k in job.fields_requested if k not in simulated_data]
    if missing:
        log.warning("RPA could not retrieve: %s", missing)

    job.status = "COMPLETE"
    job.result = result
    return result


def pdf_analysis_stub(job: RetrievalJob) -> dict[str, Any]:
    """
    Stub for AI-powered PDF / EOB analysis.

    Production implementation would:
      1. Retrieve patient's most recent EOB PDF from document store
      2. Send to Claude / GPT-4o Vision with a structured extraction prompt
      3. Parse the JSON response back into field_path → value dict
      4. Confidence-score each extracted field (low-confidence fields flagged)

    Particularly effective for: MetLife, Guardian, Principal (PDF-heavy carriers).
    """
    log.info("PDF_ANALYSIS stub executing for job %s", job.job_id[:8])

    simulated_data: dict[str, Any] = {
        "missing_tooth_clause": {
            "applies": False,
            "notes": "No missing tooth clause identified in plan documents.",
            "affected_teeth": [],
        },
        "waiting_period.major": {
            "months": 0,
            "waived_for": "accident",
            "effective_date": "2024-01-01",
        },
        "frequency_limits.D4910": {
            "times_per_period": 4,
            "period": "calendar_year",
            "used_this_period": 0,
        },
        "ortho_lifetime_maximum": 150000,   # cents
        "fluoride_coverage": True,
    }

    result = {k: simulated_data[k] for k in job.fields_requested if k in simulated_data}
    missing = [k for k in job.fields_requested if k not in simulated_data]
    if missing:
        log.warning("PDF analysis could not retrieve: %s", missing)

    job.status = "COMPLETE"
    job.result = result
    return result


def manual_call_stub(job: RetrievalJob) -> dict[str, Any]:
    """
    Last-resort: generates a pre-filled call script for the front desk.
    Returns empty dict (no automated data) but logs the script.
    """
    script = (
        f"\n{'─'*60}\n"
        f"📞 MANUAL CALL SCRIPT — Job {job.job_id[:8]}\n"
        f"Carrier:   {job.carrier}\n"
        f"Member ID: {job.member_id}\n"
        f"Ask for:   {', '.join(job.fields_requested)}\n"
        f"{'─'*60}\n"
        f"Sample script:\n"
        f"  'Hi, this is [Office Name] calling to verify benefits for member\n"
        f"   {job.member_id}. I need to confirm the following:\n"
    )
    for fp in job.fields_requested:
        reg = next((r for r in FIELD_REGISTRY if r["field_path"] == fp), None)
        desc = reg["description"] if reg else fp
        script += f"   - {desc}\n"
    script += "'"
    log.warning(script)
    job.status = "MANUAL_REQUIRED"
    return {}


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — RETRIEVAL DISPATCHER
# ══════════════════════════════════════════════════════════════════════════════

def dispatch_and_collect(jobs: list[RetrievalJob]) -> dict[str, Any]:
    """
    Executes all retrieval jobs (synchronously in this stub — async in prod)
    and collects all retrieved field values into a single flat dict.

    In production this would:
      - Publish each job to an SQS / Redis queue
      - Wait for completion via polling or webhook (with a timeout)
      - Handle partial failures gracefully
    """
    collected: dict[str, Any] = {}

    # Sort: CRITICAL jobs first, then IMPORTANT, then NICE_TO_HAVE
    priority = {Criticality.CRITICAL: 0, Criticality.IMPORTANT: 1, Criticality.NICE_TO_HAVE: 2}
    sorted_jobs = sorted(jobs, key=lambda j: priority.get(j.criticality, 9))

    for job in sorted_jobs:
        log.info("Executing job %s | method: %s | criticality: %s", job.job_id[:8], job.method.value, job.criticality.value)
        if job.method == RetrievalMethod.RPA_SCRAPE:
            result = rpa_scrape_stub(job)
        elif job.method == RetrievalMethod.PDF_ANALYSIS:
            result = pdf_analysis_stub(job)
        else:
            result = manual_call_stub(job)
        collected.update(result)

    return collected


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9 — DATA MERGER
# ══════════════════════════════════════════════════════════════════════════════

def merge_into_smart_breakdown(
    api_response: dict,
    secondary_data: dict[str, Any],
    report: IntegrityReport,
    scheduled_procedures: list[str],
) -> SmartBreakdown:
    """
    Merges the partial clearinghouse API response with data retrieved by
    secondary services (RPA / PDF) into a single canonical Smart Breakdown.

    Merge precedence (highest → lowest):
      1. API data  — most authoritative when present
      2. RPA data  — real-time portal scrape, very reliable
      3. PDF data  — slightly less reliable (OCR/extraction errors possible)
      4. Inferred  — calculated from other fields (e.g., remaining = max - used)

    Every field in the result dict is accompanied by its source in sources dict.
    """
    audit: list[str] = []
    warnings: list[str] = []

    def note(msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        audit.append(f"[{ts}] {msg}")

    note("BEGIN data merge")

    # All field paths we care about
    all_paths = [reg["field_path"] for reg in FIELD_REGISTRY]
    merged_fields: dict[str, Any] = {}
    merged_sources: dict[str, MergeSource] = {}

    for path in all_paths:
        api_val  = _get_nested(api_response, path)
        sec_val  = secondary_data.get(path)

        if not _is_missing(api_val):
            merged_fields[path]  = api_val
            merged_sources[path] = MergeSource.API
            note(f"  ✓ {path} ← API")
        elif not _is_missing(sec_val):
            # Determine whether it came from RPA or PDF by checking job results
            source = MergeSource.RPA
            for job in report.retrieval_jobs:
                if path in job.result:
                    if job.method == RetrievalMethod.RPA_SCRAPE:
                        source = MergeSource.RPA
                    elif job.method == RetrievalMethod.PDF_ANALYSIS:
                        source = MergeSource.PDF
                    else:
                        source = MergeSource.MANUAL
                    break
            merged_fields[path]  = sec_val
            merged_sources[path] = source
            note(f"  ✓ {path} ← {source.value.upper()}")
        else:
            merged_fields[path]  = None
            merged_sources[path] = MergeSource.MISSING
            note(f"  ✗ {path} — still MISSING after all retrieval attempts")
            # Check if this missing field is relevant to today
            reg = next((r for r in FIELD_REGISTRY if r["field_path"] == path), None)
            if reg:
                relevant = _procedure_is_relevant(scheduled_procedures, reg["procedures"])
                if relevant and reg["criticality"] in (Criticality.CRITICAL, Criticality.IMPORTANT):
                    warnings.append(f"⚠ {reg['description']} could not be retrieved — estimate may be inaccurate")

    # ── Attempt inference for common derived fields ───────────────────────────
    # If annual_maximum_remaining is still missing but annual_maximum and
    # annual_used are both present, we can infer it.
    if merged_sources.get("annual_maximum_remaining") == MergeSource.MISSING:
        annual_max  = _get_nested(api_response, "annual_maximum") or secondary_data.get("annual_maximum")
        annual_used = _get_nested(api_response, "annual_used")    or secondary_data.get("annual_used")
        if annual_max is not None and annual_used is not None:
            inferred = annual_max - annual_used
            merged_fields["annual_maximum_remaining"]  = inferred
            merged_sources["annual_maximum_remaining"] = MergeSource.INFERRED
            note(f"  ≈ annual_maximum_remaining inferred as {inferred} ({annual_max} - {annual_used})")

    # ── Compute final completeness on merged result ───────────────────────────
    present_count = sum(1 for v in merged_fields.values() if v is not None)
    completeness  = present_count / len(all_paths) if all_paths else 0.0
    grade = _grade(completeness)
    note(f"Merged completeness: {completeness:.0%} ({grade})")

    human_note = _build_human_note(merged_fields, merged_sources, warnings, report)
    note("END data merge")

    return SmartBreakdown(
        patient_id=report.patient_id,
        carrier=report.carrier,
        member_id=report.member_id,
        completed_at=_now_iso(),
        completeness_score=completeness,
        completeness_grade=grade,
        fields=merged_fields,
        sources=merged_sources,
        human_note=human_note,
        warnings=warnings,
        audit_trail=audit,
    )


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 10 — HUMAN NOTE GENERATOR
# ══════════════════════════════════════════════════════════════════════════════

def _build_human_note(
    fields: dict[str, Any],
    sources: dict[str, MergeSource],
    warnings: list[str],
    report: IntegrityReport,
) -> str:
    """
    Generates a human-readable string suitable for a dental PMS chart note.
    This is the 'Intelligent Write-Back' from Section 4 of the requirements,
    now enhanced to include the data provenance trail.

    Example output:
      ✦ Smart Breakdown — Verified by Pulp AI [Feb 17, 2025 9:14 AM]
      Carrier: Delta Dental PPO Plus Premier | Member: DD00112233
      Data completeness: 94% (A) — sourced from API + RPA portal scrape
      ─────────────────────────────────────────────────
      Annual Max: $2,000 | Remaining: $1,450 (RPA)
      Deductible: $50 | Met: $50 ✓ Fully met (API)
      Coverage: 100% preventive · 80% basic · 50% major (API)
      ...
    """
    now = datetime.now().strftime("%b %d, %Y %I:%M %p")
    src_icons = {
        MergeSource.API:      "API",
        MergeSource.RPA:      "RPA",
        MergeSource.PDF:      "PDF",
        MergeSource.MANUAL:   "Manual",
        MergeSource.INFERRED: "Inferred",
        MergeSource.MISSING:  "MISSING",
    }

    def f_val(path: str) -> str:
        v = fields.get(path)
        src = sources.get(path, MergeSource.MISSING)
        icon = src_icons[src]
        if v is None:
            return f"UNKNOWN [{icon}]"
        if isinstance(v, int) and "cents" in path.lower():
            return f"${v / 100:,.0f} [{icon}]"
        if isinstance(v, int):
            return f"${v / 100:,.0f} [{icon}]"
        if isinstance(v, float):
            return f"{v:.0%} [{icon}]"
        if isinstance(v, bool):
            return f"{'Yes' if v else 'No'} [{icon}]"
        if isinstance(v, dict):
            return f"{json.dumps(v, separators=(',', ':'))} [{icon}]"
        return f"{v} [{icon}]"

    sources_used = {s for s in sources.values() if s != MergeSource.MISSING}
    sources_str  = " + ".join(sorted({src_icons[s] for s in sources_used}))

    lines = [
        f"✦ Smart Breakdown — Verified by Pulp AI [{now}]",
        f"Carrier: {report.carrier} | Member: {report.member_id}",
        f"Data completeness: {report.completeness_score:.0%} (pre-merge) → sources: {sources_str}",
        "─" * 52,
        f"Annual Max Remaining : {f_val('annual_maximum_remaining')}",
        f"Deductible           : {f_val('individual_deductible')} | Met: {f_val('deductible_met')}",
        f"Coverage — Basic     : {f_val('coverage_pct.basic')}",
        f"Coverage — Major     : {f_val('coverage_pct.major')}",
    ]

    freq_paths = [
        ("D1110 Adult Prophy",    "frequency_limits.D1110"),
        ("D0274 Bitewing BWX",    "frequency_limits.D0274"),
        ("D2740 PFM Crown",       "frequency_limits.D2740"),
        ("D4341 Perio SRP",       "frequency_limits.D4341"),
        ("D4910 Perio Maint.",    "frequency_limits.D4910"),
        ("D1351 Sealant",         "frequency_limits.D1351"),
    ]
    lines.append("─" * 52)
    for label, path in freq_paths:
        v = fields.get(path)
        src = src_icons.get(sources.get(path, MergeSource.MISSING), "?")
        if v is None:
            lines.append(f"Freq {label:<20}: UNKNOWN [{src}]")
        elif isinstance(v, dict):
            used  = v.get("used_this_period", v.get("used_this_year", "?"))
            total = v.get("times_per_period", v.get("quads_per_year", "?"))
            nxt   = v.get("next_eligible_date") or v.get("last_service_date") or ""
            lines.append(f"Freq {label:<20}: {used}/{total} used {(' · next: ' + nxt) if nxt else ''} [{src}]")

    mtc = fields.get("missing_tooth_clause")
    mtc_src = src_icons.get(sources.get("missing_tooth_clause", MergeSource.MISSING), "?")
    lines.append("─" * 52)
    if mtc is None:
        lines.append(f"Missing Tooth Clause : UNKNOWN [{mtc_src}]")
    elif isinstance(mtc, dict) and mtc.get("applies"):
        teeth = ", ".join(mtc.get("affected_teeth", [])) or "see notes"
        lines.append(f"Missing Tooth Clause : ⚠ APPLIES — Teeth: {teeth} [{mtc_src}]")
    else:
        lines.append(f"Missing Tooth Clause : ✓ Not applicable [{mtc_src}]")

    pdg = fields.get("composite_posterior_downgrade")
    pdg_src = src_icons.get(sources.get("composite_posterior_downgrade", MergeSource.MISSING), "?")
    if pdg is None:
        lines.append(f"Posterior Composite  : UNKNOWN [{pdg_src}]")
    elif pdg:
        lines.append(f"Posterior Composite  : ⚠ Downgraded to amalgam rate [{pdg_src}]")
    else:
        lines.append(f"Posterior Composite  : ✓ Full composite coverage [{pdg_src}]")

    if warnings:
        lines.append("─" * 52)
        lines.append("Remaining unknowns:")
        for w in warnings:
            lines.append(f"  {w}")

    lines.append("─" * 52)
    lines.append("Source key: API=Clearinghouse · RPA=Portal Scrape · PDF=EOB Analysis · Inferred=Calculated")

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 11 — MAIN ORCHESTRATOR  (the public-facing entry point)
# ══════════════════════════════════════════════════════════════════════════════

def run_fallback_manager(
    api_response: dict,
    scheduled_procedures: list[str],
    patient_id: str,
    carrier: str,
    member_id: str,
) -> SmartBreakdown:
    """
    Full pipeline:
      1. Evaluate API response integrity
      2. Dispatch secondary retrieval jobs for missing fields
      3. Merge all data into a Smart Breakdown

    This is the single function your application calls.  Pass in the raw
    Vyne / Onederful response and get back a SmartBreakdown with complete
    data, provenance, and a chart note.

    Parameters
    ----------
    api_response         : Raw dict from clearinghouse
    scheduled_procedures : e.g. ["Crown Prep #14", "4 BWX D0274"]
    patient_id           : Your internal patient UUID / ID
    carrier              : Carrier name string (for RPA routing)
    member_id            : Member ID from insurance card

    Returns
    -------
    SmartBreakdown — the canonical, merged, fully-annotated benefit record
    """
    print("\n" + "═"*60)
    print("  PULP FALLBACK MANAGER — Starting pipeline")
    print("═"*60)

    # Step 1: Integrity evaluation
    report = evaluate_integrity(
        api_response=api_response,
        scheduled_procedures=scheduled_procedures,
        patient_id=patient_id,
        carrier=carrier,
        member_id=member_id,
    )

    print(f"\n  Integrity Score:  {report.completeness_score:.0%} ({report.completeness_grade})")
    print(f"  Block Appt:       {report.block_appointment}")
    print(f"  CRITICAL missing: {len(report.critical_missing)}")
    print(f"  IMPORTANT missing:{len(report.important_missing)}")
    print(f"  Retrieval jobs:   {len(report.retrieval_jobs)}")

    # Step 2: Secondary retrieval
    if report.retrieval_jobs:
        print(f"\n  Dispatching {len(report.retrieval_jobs)} retrieval job(s)…")
        secondary_data = dispatch_and_collect(report.retrieval_jobs)
        print(f"  Retrieved {len(secondary_data)} additional field(s)")
    else:
        secondary_data = {}
        print("\n  No retrieval jobs needed — API response is complete.")

    # Step 3: Merge
    print("\n  Merging data sources…")
    breakdown = merge_into_smart_breakdown(
        api_response=api_response,
        secondary_data=secondary_data,
        report=report,
        scheduled_procedures=scheduled_procedures,
    )

    print(f"\n  Final completeness: {breakdown.completeness_score:.0%} ({breakdown.completeness_grade})")
    print(f"  Remaining warnings: {len(breakdown.warnings)}")
    print("═"*60 + "\n")

    return breakdown


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 12 — DEMO / TEST HARNESS
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":

    # ── Scenario 1: Vyne returns an intentionally incomplete response ─────────
    # Simulates a real-world partial response missing frequency limits and max.
    PARTIAL_API_RESPONSE = {
        "plan_status": "active",
        "verification_status": "verified",
        "payer_name": "Delta Dental PPO Plus Premier",
        "benefit_year_start": "2025-01-01",
        "benefit_year_end": "2025-12-31",
        # annual_maximum_remaining is MISSING ← will be flagged CRITICAL
        "annual_maximum": 200000,      # plan max in cents
        "annual_used": 55000,          # used so far (allows inference)
        "individual_deductible": 5000,
        "deductible_met": 5000,        # both deductible fields present ✓
        # frequency_limits block is almost entirely missing
        "frequency_limits": {
            "D1110": {                 # Prophy is present ✓
                "times_per_period": 2,
                "period": "calendar_year",
                "used_this_period": 1,
                "next_eligible_date": "2025-07-10",
            },
            # D2740 crown freq is MISSING ← CRITICAL for today's crown
            # D4341 SRP freq is MISSING   ← CRITICAL for today's SRP
            # D0274 BWX freq is MISSING   ← IMPORTANT for today's BWX
        },
        # missing_tooth_clause, waiting_period, composite_downgrade all absent
        "coverage_pct": {
            # basic missing, major missing ← IMPORTANT
        },
    }

    # Today's patient has a Crown + SRP + BWX scheduled — all the CRITICAL paths
    SCHEDULED = ["Crown Prep #14 D2740", "Perio SRP D4341 Q1 Q2", "4 Bitewing BWX D0274"]

    breakdown = run_fallback_manager(
        api_response=PARTIAL_API_RESPONSE,
        scheduled_procedures=SCHEDULED,
        patient_id="patient_abc123",
        carrier="Delta Dental PPO",
        member_id="DD00112233",
    )

    # ── Print Smart Breakdown ─────────────────────────────────────────────────
    print("\n" + "━"*60)
    print("  SMART BREAKDOWN — Final Output")
    print("━"*60)
    print(breakdown.human_note)

    # ── Print provenance summary ──────────────────────────────────────────────
    print("\n" + "━"*60)
    print("  FIELD PROVENANCE SUMMARY")
    print("━"*60)
    src_counts: dict[str, int] = {}
    for path, src in breakdown.sources.items():
        src_counts[src.value] = src_counts.get(src.value, 0) + 1
    for src, count in sorted(src_counts.items()):
        print(f"  {src:<12}: {count} fields")

    # ── Print warnings ────────────────────────────────────────────────────────
    if breakdown.warnings:
        print("\n" + "━"*60)
        print("  REMAINING UNKNOWNS (could not be retrieved)")
        print("━"*60)
        for w in breakdown.warnings:
            print(f"  {w}")

    # ── Scenario 2: Completely empty response (worst case) ───────────────────
    print("\n\n" + "═"*60)
    print("  SCENARIO 2: Empty API Response (Worst Case)")
    print("═"*60)

    breakdown2 = run_fallback_manager(
        api_response={},
        scheduled_procedures=["Implant Consult #30 D6010"],
        patient_id="patient_xyz789",
        carrier="MetLife Dental",
        member_id="MET44412222",
    )

    print(f"\n  Completeness after all retrieval: {breakdown2.completeness_score:.0%}")
    print(f"  Warnings: {len(breakdown2.warnings)}")
    print("\n  Chart Note Preview:")
    print(breakdown2.human_note[:800] + "…")

    # ── Export to JSON (ready for PMS / API response) ─────────────────────────
    output = {
        "patient_id": breakdown.patient_id,
        "carrier": breakdown.carrier,
        "completeness_score": round(breakdown.completeness_score, 4),
        "completeness_grade": breakdown.completeness_grade,
        "human_note": breakdown.human_note,
        "warnings": breakdown.warnings,
        "fields": {k: v for k, v in breakdown.fields.items() if v is not None},
        "sources": {k: v.value for k, v in breakdown.sources.items()},
    }
    with open("smart_breakdown_output.json", "w") as fh:
        json.dump(output, fh, indent=2, default=str)
    print("\n  ✓ Full output written to smart_breakdown_output.json")
