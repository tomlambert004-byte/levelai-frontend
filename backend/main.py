from pathlib import Path
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from normalizer import normalize_271
from pms_service import get_patient_clinical_data
from llm_service import generate_preauth_letter

app = FastAPI(title="Pulp AI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"
FIXTURE_MAP = {
    "p1": "271_active_clean.json",
    "p2": "271_composite_downgrade_low_max.json",
    "p3": "271_inactive_plan.json",
    "p4": "271_missing_tooth_clause.json",
    "p5": "271_active_deductible_not_met.json",
    "p6": "271_frequency_limit.json",
}

class VerifyRequest(BaseModel):
    patient_id: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "Pulp AI"}

@app.post("/api/verify")
def verify(req: VerifyRequest):
    fixture_file = FIXTURE_MAP.get(req.patient_id)
    if not fixture_file:
        raise HTTPException(status_code=404, detail=f"No fixture for patient_id '{req.patient_id}'")
    fixture_path = FIXTURES_DIR / fixture_file
    if not fixture_path.exists():
        raise HTTPException(status_code=500, detail=f"Fixture file missing: {fixture_file}")
    with open(fixture_path) as f:
        raw_271 = json.load(f)
    return normalize_271(raw_271)


# ── Pre-Authorization Generator ───────────────────────────────────────────────

class PreauthRequest(BaseModel):
    patient_id: str
    procedure_code: str

class PreauthResponse(BaseModel):
    patient_id: str
    procedure_code: str
    letter: str
    attached_files: list[dict]
    clinical_summary: dict

@app.post("/api/preauth/generate", response_model=PreauthResponse)
def generate_preauth(req: PreauthRequest):
    """
    POST /api/preauth/generate
    Body: { "patient_id": "p4", "procedure_code": "D6010" }

    1. Fetches clinical data from the PMS service (mock or live)
    2. Sends it to Claude via llm_service to draft the Letter of Medical Necessity
    3. Returns the letter text + attachment list + clinical summary

    The Next.js proxy at /api/v1/preauth/generate forwards requests here.
    """
    # Step 1 — PMS lookup
    clinical = get_patient_clinical_data(req.patient_id, req.procedure_code)
    if not clinical:
        raise HTTPException(
            status_code=404,
            detail=f"No clinical data found for patient '{req.patient_id}' / procedure '{req.procedure_code}'"
        )

    # Step 2 — LLM letter generation
    try:
        letter = generate_preauth_letter(clinical)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Step 3 — Return structured response
    return PreauthResponse(
        patient_id=req.patient_id,
        procedure_code=req.procedure_code,
        letter=letter,
        attached_files=clinical.get("attached_files", []),
        clinical_summary={
            "patient_name":           clinical.get("patient_name"),
            "date_of_birth":          clinical.get("date_of_birth"),
            "member_id":              clinical.get("member_id"),
            "insurance_carrier":      clinical.get("insurance_carrier"),
            "procedure_description":  clinical.get("procedure_description"),
            "tooth_numbers":          clinical.get("tooth_numbers", []),
            "treating_provider":      clinical.get("treating_provider"),
            "appointment_date":       clinical.get("appointment_date"),
            "estimated_fee_cents":    clinical.get("estimated_fee_cents"),
            "coverage_pct":           clinical.get("insurance_estimated_coverage_pct"),
        },
    )
