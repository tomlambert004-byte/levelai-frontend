"""
main.py
Pulp AI — FastAPI backend
Runs on localhost:8000

Endpoints:
    POST /api/verify     — verify a patient's insurance eligibility
    GET  /api/patients   — list today's patients
    GET  /health         — health check

Start with:
    uvicorn main:app --reload --port 8000
"""

import json
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from normalizer import normalize_271

app = FastAPI(title="Pulp AI", version="0.1.0")

# ─── CORS — allow the Next.js frontend to call this ──────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Fixture map — patient_id → fixture file ─────────────────────────────────
FIXTURES_DIR = Path(__file__).parent / "fixtures"

FIXTURE_MAP = {
    "p1": "271_active_clean.json",
    "p2": "271_composite_downgrade_low_max.json",
    "p3": "271_inactive_plan.json",
    "p4": "271_missing_tooth_clause.json",
    "p5": "271_active_deductible_not_met.json",
    "p6": "271_frequency_limit.json",
}


# ─── Request models ───────────────────────────────────────────────────────────
class VerifyRequest(BaseModel):
    patient_id: str


class ChatRequest(BaseModel):
    question: str
    patient_id: str | None = None
    coverage_json: dict | None = None


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "Pulp AI"}


@app.post("/api/verify")
def verify(req: VerifyRequest):
    """
    Load the fixture for this patient, run it through the normalizer,
    and return the normalized result to the frontend.

    When you're ready for a real clearinghouse, replace the fixture
    loading block with your API call — normalize_271() stays the same.
    """
    fixture_file = FIXTURE_MAP.get(req.patient_id)

    if not fixture_file:
        # Unknown patient — return a safe default (pending/unverified)
        raise HTTPException(
            status_code=404,
            detail=f"No fixture found for patient_id '{req.patient_id}'"
        )

    fixture_path = FIXTURES_DIR / fixture_file
    if not fixture_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Fixture file missing: {fixture_file}"
        )

    with open(fixture_path) as f:
        raw_271 = json.load(f)

    result = normalize_271(raw_271)
    return result


@app.post("/api/chat")
def chat(req: ChatRequest):
    """
    Simple rule-based chat responses using the patient's coverage data.
    Replace with an LLM call when ready.
    """
    q = (req.question or "").lower()
    cov = req.coverage_json or {}

    def dollars(cents):
        if cents is None:
            return "unknown"
        return f"${cents / 100:,.0f}"

    # Pull useful fields from coverage
    remaining   = cov.get("annual_remaining_cents")
    max_amt     = cov.get("annual_maximum_cents")
    ded         = cov.get("individual_deductible_cents")
    ded_met     = cov.get("individual_deductible_met_cents")
    plan_status = cov.get("plan_status", "unknown")
    payer       = cov.get("payer_name", "their carrier")
    mtc         = cov.get("missing_tooth_clause", {})
    flags       = cov.get("action_flags", [])

    # Route question to answer
    if any(w in q for w in ["deductible"]):
        if ded is not None and ded_met is not None:
            remaining_ded = max(0, ded - ded_met)
            if remaining_ded == 0:
                answer = f"Deductible fully met ({dollars(ded_met)} of {dollars(ded)})."
            else:
                answer = f"Deductible not yet met. {dollars(ded_met)} of {dollars(ded)} satisfied. {dollars(remaining_ded)} still owed."
        else:
            answer = "Deductible information not available in the verification response."

    elif any(w in q for w in ["remaining", "maximum", "max", "left", "balance"]):
        if remaining is not None:
            answer = f"{dollars(remaining)} remaining out of {dollars(max_amt)} annual maximum with {payer}."
        else:
            answer = "Annual maximum data not available."

    elif any(w in q for w in ["status", "active", "inactive", "plan"]):
        answer = f"Plan is currently {plan_status} with {payer}."
        if plan_status != "active":
            answer += " Patient should be contacted before appointment."

    elif any(w in q for w in ["missing tooth", "mtc", "implant"]):
        if mtc.get("applies"):
            teeth = ", ".join(mtc.get("affected_teeth", []))
            answer = f"Missing Tooth Clause applies to tooth/teeth: {teeth}. Pre-authorization likely required."
            if mtc.get("exception_pathway"):
                answer += f" Exception pathway: {mtc['exception_pathway']}"
        else:
            answer = "No Missing Tooth Clause on file for this patient."

    elif any(w in q for w in ["flag", "issue", "problem", "action"]):
        if flags:
            answer = f"Active flags: {', '.join(f.replace('_', ' ') for f in flags)}."
        else:
            answer = "No action flags. Verification is clear."

    elif any(w in q for w in ["cleaning", "frequency", "prophylaxis"]):
        prev = cov.get("preventive", {})
        cf   = prev.get("cleaning_frequency", {}) if prev else {}
        used  = cf.get("used_this_period")
        total = cf.get("times_per_period")
        nxt   = cf.get("next_eligible_date")
        if used is not None and total is not None:
            if used >= total:
                answer = f"Cleaning frequency limit reached ({used}/{total}). Next eligible: {nxt or 'next benefit period'}."
            else:
                answer = f"{used} of {total} cleanings used this benefit period. {total - used} remaining."
        else:
            answer = "Cleaning frequency data not available."

    else:
        # Fallback summary
        if plan_status == "active":
            answer = (
                f"Plan is active with {payer}. "
                f"{dollars(remaining)} remaining. "
                f"Deductible: {dollars(ded_met)} of {dollars(ded)} met. "
                f"Flags: {', '.join(flags) if flags else 'none'}."
            )
        else:
            answer = f"Plan is {plan_status} with {payer}. Patient contact recommended before proceeding."

    return {"answer": answer}
