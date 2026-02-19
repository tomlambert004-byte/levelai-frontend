from pathlib import Path
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from normalizer import normalize_271

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