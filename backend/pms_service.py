"""
pms_service.py — Mock PMS Data Service
=======================================
Simulates a real Practice Management System (e.g. Open Dental) API.
Architecture: swap get_patient_clinical_data() implementation for a live
HTTP call to your PMS when you're ready to go live.

Returned schema mirrors what a real Open Dental API would provide so the
LLM service and pre-auth route are PMS-agnostic.
"""

from __future__ import annotations
from dataclasses import dataclass, asdict, field
from typing import Optional


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class ClinicalNote:
    date: str
    provider: str
    note: str


@dataclass
class AttachedFile:
    filename: str
    file_type: str          # "xray" | "chart" | "photo" | "report"
    description: str


@dataclass
class PatientClinicalData:
    # Patient demographics
    patient_id: str
    patient_name: str
    date_of_birth: str
    member_id: str
    insurance_carrier: str
    group_number: str

    # Procedure being requested
    procedure_code: str
    procedure_description: str
    tooth_numbers: list[str]
    treating_provider: str
    facility_name: str
    appointment_date: str

    # Clinical evidence
    clinical_notes: list[ClinicalNote]
    relevant_history: dict                # free-form key/value history facts
    attached_files: list[AttachedFile]

    # Financial context (useful for necessity argument)
    estimated_fee_cents: int
    insurance_estimated_coverage_pct: int


# ── Mock PMS database ─────────────────────────────────────────────────────────
# Keyed by (patient_id, procedure_code).  Falls back to patient_id alone.

_PMS_DB: dict[tuple[str, str], PatientClinicalData] = {}


def _reg(data: PatientClinicalData) -> None:
    _PMS_DB[(data.patient_id, data.procedure_code)] = data


# ── Scenario 1: D6010 — Implant body placement (James Whitfield / p4) ─────────
_reg(PatientClinicalData(
    patient_id="p4",
    patient_name="James Whitfield",
    date_of_birth="2002-01-30",
    member_id="AET77700011",
    insurance_carrier="Aetna DMO Essential",
    group_number="GRP-077700",
    procedure_code="D6010",
    procedure_description="Implant Body Placement — Tooth #14",
    tooth_numbers=["#14"],
    treating_provider="Dr. Sarah Patel, DDS",
    facility_name="Georgetown Dental Associates",
    appointment_date="2026-03-15",
    clinical_notes=[
        ClinicalNote(
            date="2024-03-10",
            provider="Dr. Patel",
            note=(
                "Tooth #14 extracted due to irreparable fracture secondary to trauma. "
                "Socket healing uneventful. Patient counseled regarding implant restoration "
                "as the optimal long-term solution to maintain arch integrity and prevent "
                "supraeruption of opposing #3."
            ),
        ),
        ClinicalNote(
            date="2025-11-05",
            provider="Dr. Patel",
            note=(
                "6-month post-extraction evaluation: bone volume at site #14 adequate for "
                "implant placement. Panoramic radiograph confirms 12mm available bone height "
                "above the maxillary sinus. No contraindications noted. Patient medically fit "
                "(ASA I). Treatment plan presented; patient consents to implant therapy."
            ),
        ),
        ClinicalNote(
            date="2026-01-18",
            provider="Dr. Patel",
            note=(
                "Pre-surgical consult. CBCT confirms 13.2mm bone height, 7.8mm buccolingual "
                "width at proposed implant site. Nobel Biocare 4.3x10mm implant selected. "
                "Signed surgical consent obtained. Pre-auth submitted to Aetna DMO."
            ),
        ),
    ],
    relevant_history={
        "extraction_date": "2024-03-10",
        "extraction_reason": "Irreparable crown-root fracture (trauma)",
        "bone_height_mm": 13.2,
        "bone_width_mm": 7.8,
        "sinus_clearance_mm": 12.0,
        "opposing_tooth": "#3 (maxillary molar, fully erupted)",
        "medical_history": "Non-smoker, no systemic disease, no blood thinners",
        "cbct_date": "2026-01-10",
        "proposed_implant": "Nobel Biocare NP 4.3x10mm",
        "missing_tooth_clause_applies": True,
        "exception_pathway": (
            "Extraction pre-dates current coverage. Pre-auth with dated records submitted. "
            "Appeal pathway available per plan terms."
        ),
    },
    attached_files=[
        AttachedFile("panorex_03_2024.jpg",     "xray",   "Panoramic radiograph at time of extraction (Mar 2024)"),
        AttachedFile("cbct_01_2026.dcm",         "xray",   "CBCT scan showing 13.2mm bone height at #14 (Jan 2026)"),
        AttachedFile("perio_chart_11_2025.pdf",  "chart",  "Full periodontal chart — all sites ≤3mm, no bone loss"),
        AttachedFile("surgical_consent.pdf",     "report", "Signed patient consent for implant surgery"),
        AttachedFile("extraction_op_note.pdf",   "report", "Original extraction operative note (Mar 2024)"),
    ],
    estimated_fee_cents=350000,
    insurance_estimated_coverage_pct=50,
))


# ── Scenario 2: D4342 — Periodontal Scaling & Root Planing (Derek Fontaine / p6) ──
_reg(PatientClinicalData(
    patient_id="p6",
    patient_name="Derek Fontaine",
    date_of_birth="1970-03-28",
    member_id="DD00998877",
    insurance_carrier="Delta Dental PPO Plus Premier",
    group_number="GRP-009988",
    procedure_code="D4342",
    procedure_description="Periodontal Scaling & Root Planing — 1-3 Teeth per Quadrant",
    tooth_numbers=["#3", "#4", "#5", "#14", "#15", "#19", "#30"],
    treating_provider="Dr. James Chen, DDS, MS — Periodontist",
    facility_name="Georgetown Dental Associates",
    appointment_date="2026-04-02",
    clinical_notes=[
        ClinicalNote(
            date="2026-01-15",
            provider="Dr. Chen",
            note=(
                "Comprehensive periodontal evaluation. Patient presents with generalized moderate "
                "chronic periodontitis. Pocket depths 4-6mm noted in posterior quadrants bilaterally. "
                "Bleeding on probing: 62%. Generalized 1-2mm bone loss on bitewing radiographs. "
                "Calculus deposits — moderate supragingival, heavy subgingival in posterior sextants. "
                "Diagnosis: ADA Case Type III — Moderate Periodontitis."
            ),
        ),
        ClinicalNote(
            date="2026-01-15",
            provider="Dr. Chen",
            note=(
                "Treatment plan: Full-mouth SRP in 2 appointments (UR/LR, UL/LL). "
                "Oral hygiene instruction provided. Patient understands that untreated periodontitis "
                "is associated with systemic conditions including cardiovascular disease and diabetes. "
                "Patient has history of type 2 diabetes (HbA1c 7.2% per PCP records). "
                "SRP is medically necessary to reduce periodontal infection burden."
            ),
        ),
    ],
    relevant_history={
        "last_prophy_date": "2024-08-01",
        "prophy_frequency_used": "2/2 for calendar year 2026",
        "diagnosis": "ADA Case Type III — Moderate Chronic Periodontitis",
        "average_pocket_depth_mm": 4.8,
        "max_pocket_depth_mm": 6,
        "bleeding_on_probing_pct": 62,
        "bone_loss_on_radiograph": "1-2mm generalized horizontal, posterior sextants",
        "systemic_link": "Type 2 Diabetes (HbA1c 7.2%) — bidirectional relationship with periodontitis",
        "calculus_deposits": "Moderate supragingival; heavy subgingival — posterior",
        "quadrants_requiring_srp": 4,
    },
    attached_files=[
        AttachedFile("perio_chart_01_2026.pdf",  "chart",  "Full periodontal chart — pocket depths, BOP, furcation (Jan 2026)"),
        AttachedFile("bitewing_xrays_01_2026.jpg","xray",   "4 bitewing radiographs showing interproximal bone levels"),
        AttachedFile("diabetes_hba1c_report.pdf", "report", "PCP lab report — HbA1c 7.2% (Dec 2025)"),
        AttachedFile("oral_hygiene_instructions.pdf","report","Patient education materials provided at consultation"),
    ],
    estimated_fee_cents=120000,
    insurance_estimated_coverage_pct=80,
))


# ── Scenario 3: D3310 — Root Canal, anterior (Susan Nakamura / p5) ─────────
_reg(PatientClinicalData(
    patient_id="p5",
    patient_name="Susan Nakamura",
    date_of_birth="1983-09-14",
    member_id="GRD55566677",
    insurance_carrier="Guardian DentalGuard Preferred",
    group_number="GRP-055566",
    procedure_code="D3310",
    procedure_description="Endodontic Therapy — Anterior Tooth (Root Canal)",
    tooth_numbers=["#9"],
    treating_provider="Dr. Maria Rodriguez, DDS, MS — Endodontist",
    facility_name="Georgetown Dental Associates",
    appointment_date="2026-03-22",
    clinical_notes=[
        ClinicalNote(
            date="2026-02-10",
            provider="Dr. Rodriguez",
            note=(
                "Patient presents with spontaneous, severe, continuous pain in upper left anterior "
                "region for 5 days. Tooth #9: percussion positive (3/3), palpation positive (2/3), "
                "cold test — no response (necrotic). Periapical radiograph: widened PDL space and "
                "early periapical rarefaction at apex of #9. Diagnosis: Pulp necrosis with "
                "symptomatic apical periodontitis. Immediate RCT indicated."
            ),
        ),
        ClinicalNote(
            date="2026-02-10",
            provider="Dr. Rodriguez",
            note=(
                "Emergency access opening performed. Copious exudate on access — consistent with "
                "acute infection. Canals instrumented to working length (22mm), irrigated with "
                "5.25% NaOCl and 17% EDTA. Calcium hydroxide placed as interappointment dressing. "
                "Patient placed on amoxicillin 500mg TID x 7 days. Pain significantly reduced "
                "post-op. Final obturation appointment scheduled."
            ),
        ),
    ],
    relevant_history={
        "pain_onset": "5 days prior to presentation",
        "pain_character": "Spontaneous, severe, continuous — not responsive to OTC analgesics",
        "percussion_test": "Positive (3/3)",
        "cold_test": "No response (necrotic pulp)",
        "periapical_status": "Early periapical rarefaction on PA radiograph",
        "diagnosis": "Pulp necrosis with symptomatic apical periodontitis",
        "trauma_history": "Sports injury (basketball) — tooth #9, age 14",
        "prior_restoration": "Composite resin restoration #9 (2019)",
        "antibiotic_prescribed": "Amoxicillin 500mg TID x 7 days",
        "working_length_mm": 22,
    },
    attached_files=[
        AttachedFile("pa_xray_tooth9_02_2026.jpg", "xray",   "Periapical radiograph showing widened PDL and periapical rarefaction (#9)"),
        AttachedFile("emergency_op_note.pdf",       "report", "Emergency access operative note (Feb 10, 2026)"),
        AttachedFile("rx_amoxicillin.pdf",          "report", "Prescription record — Amoxicillin 500mg"),
    ],
    estimated_fee_cents=115000,
    insurance_estimated_coverage_pct=80,
))


# ── Public API ─────────────────────────────────────────────────────────────────

def get_patient_clinical_data(patient_id: str, procedure_code: str) -> dict | None:
    """
    Returns structured clinical data for the given patient + procedure.
    Returns None if no match found.

    To go live: replace this function body with an HTTP call to your
    PMS API endpoint, e.g.:
        response = await httpx.get(PMS_BASE_URL + "/clinical", params={...})
        return response.json()
    """
    # Exact match first
    data = _PMS_DB.get((patient_id, procedure_code))
    if not data:
        # Fall back to first record for this patient (demo convenience)
        data = next(
            (v for (pid, _), v in _PMS_DB.items() if pid == patient_id),
            None,
        )
    if not data:
        return None

    result = asdict(data)
    # Serialize nested dataclasses to plain dicts (already done by asdict)
    return result


def list_available_scenarios() -> list[dict]:
    """Returns a summary of all mock PMS scenarios — useful for testing."""
    return [
        {
            "patient_id": pid,
            "procedure_code": proc,
            "patient_name": v.patient_name,
            "procedure_description": v.procedure_description,
        }
        for (pid, proc), v in _PMS_DB.items()
    ]


# ── CLI demo ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json
    print("=== Available PMS Scenarios ===")
    for s in list_available_scenarios():
        print(f"  {s['patient_id']} / {s['procedure_code']} — {s['patient_name']}: {s['procedure_description']}")

    print("\n=== Sample payload (p4 / D6010) ===")
    data = get_patient_clinical_data("p4", "D6010")
    print(json.dumps(data, indent=2))
