"""
Pulp — Python Microservice (FastAPI)
Wraps pulp_fallback_manager.py and exposes it over HTTP on port 8000.
Your Next.js proxy (app/api/verify/route.js) calls this directly;
the browser never talks to this server.

Start with:
  uvicorn api:app --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Optional
import traceback
import anthropic   # pip install anthropic

# Import your fallback manager (must be in the same directory)
from pulp_fallback_manager import run_fallback_manager, SmartBreakdown

app = FastAPI(title="Pulp Verification API", version="2.0.0")

# Allow calls from the Next.js dev server only.
# Do NOT change — these match your existing CORS setup.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── HIPAA AAA Rejection Code dictionary ──────────────────────────────────────
# Maps standard HIPAA 835/277 adjustment reason codes to human-readable
# staff instructions.  Extend this dict as new codes appear in your
# Change Healthcare responses.

HIPAA_CODE_ACTIONS: dict[int, dict] = {
    1:   {"label": "Deductible Amount",
          "severity": "info",
          "action": "Confirm patient's remaining deductible before collecting. Cross-check with EOB if available."},
    2:   {"label": "Coinsurance Amount",
          "severity": "info",
          "action": "Review coinsurance percentage in the benefit breakdown and inform patient of estimated out-of-pocket."},
    3:   {"label": "Co-payment Amount",
          "severity": "info",
          "action": "Collect copay at time of service. Verify copay tier for this procedure type."},
    4:   {"label": "Procedure not covered",
          "severity": "warning",
          "action": "Confirm CDT code matches the treatment being rendered. Consider alternative covered codes or submit a narrative."},
    5:   {"label": "Service Not Authorized",
          "severity": "critical",
          "action": "Pre-authorization required. Do NOT render service until auth number is obtained from carrier."},
    16:  {"label": "Claim/service lacks info",
          "severity": "critical",
          "action": "Action: Missing pre-op X-ray or required clinical narrative. Attach documentation and resubmit before proceeding."},
    18:  {"label": "Duplicate claim/service",
          "severity": "warning",
          "action": "Check for duplicate entry in your PMS. Verify claim number against original submission."},
    22:  {"label": "This care may be covered by another payer",
          "severity": "warning",
          "action": "Action: Coordinate benefits — confirm primary vs. secondary payer order. Request COB information from patient."},
    27:  {"label": "Expenses incurred after policy terminated",
          "severity": "critical",
          "action": "Action: Insurance was not active on date of service. Collect full fee from patient and advise them to contact carrier."},
    29:  {"label": "Claim received after filing limit",
          "severity": "critical",
          "action": "Filing deadline has passed. Review timely filing policy and consider appeal with proof of timely submission."},
    45:  {"label": "Charge exceeds fee schedule",
          "severity": "info",
          "action": "Carrier has a contracted maximum. Adjust write-off per your PPO agreement — do not balance-bill patient."},
    96:  {"label": "Non-covered charge",
          "severity": "warning",
          "action": "Action: Service is excluded under this plan. Obtain Advance Beneficiary Notice (ABN) signed by patient before proceeding."},
    97:  {"label": "Payment included in allowance for another service",
          "severity": "info",
          "action": "Bundled into a primary procedure. Check CDT bundling rules for this carrier."},
    109: {"label": "Claim not covered by payer",
          "severity": "critical",
          "action": "Wrong payer or plan. Verify insurance card and resubmit to correct carrier."},
    119: {"label": "Benefit maximum for this period has been reached",
          "severity": "warning",
          "action": "Action: Annual maximum exhausted. Collect full fee from patient or postpone non-urgent treatment to next benefit year."},
    131: {"label": "Claim specific negotiated discount",
          "severity": "info",
          "action": "Contracted discount applied. Confirm write-off amount matches your fee schedule."},
    197: {"label": "Pre-cert/prior auth not received",
          "severity": "critical",
          "action": "Authorization missing. Pause treatment, obtain auth number, then resubmit claim with auth reference."},
    252: {"label": "An attachment is required",
          "severity": "warning",
          "action": "Attach supporting documentation (X-ray, periodontal charting, narrative) and resubmit."},
}


def resolve_hipaa_codes(codes: list[int]) -> list[dict]:
    """Return enriched action objects for each code present in the response."""
    resolved = []
    for code in codes:
        entry = HIPAA_CODE_ACTIONS.get(code)
        if entry:
            resolved.append({"code": code, **entry})
        else:
            resolved.append({
                "code": code,
                "label": f"Adjustment Code {code}",
                "severity": "info",
                "action": f"Review carrier documentation for code {code}.",
            })
    return resolved


# ── Request / Response schemas ────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    patient_id: str
    carrier: str
    member_id: str
    scheduled_procedures: list[str]
    api_response: dict[str, Any]   # raw Change Healthcare / clearinghouse JSON


class VerifyResponse(BaseModel):
    patient_id: str
    carrier: str
    member_id: str
    completed_at: str
    completeness_score: float
    completeness_grade: str
    fields: dict[str, Any]
    sources: dict[str, str]
    human_note: str
    warnings: list[str]
    hipaa_code_actions: list[dict]  # enriched HIPAA code guidance for the drawer


class ChatRequest(BaseModel):
    patient_id: str
    question: str
    coverage_json: dict[str, Any]   # the full verification result from the front-end


class ChatResponse(BaseModel):
    answer: str
    patient_id: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "pulp-verification-api", "version": "2.0.0"}


@app.get("/hipaa-codes")
def get_hipaa_codes():
    """Return the full HIPAA code dictionary for front-end use."""
    return {"codes": HIPAA_CODE_ACTIONS}


@app.post("/api/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    """
    Main eligibility verification endpoint.
    Accepts the raw Change Healthcare response + patient context,
    runs the fallback manager, enriches with HIPAA code guidance,
    and returns a complete breakdown.

    NOTE: Do not alter the api_response parsing logic or the
    Change Healthcare authentication above this layer.
    """
    try:
        breakdown: SmartBreakdown = run_fallback_manager(
            api_response=req.api_response,
            scheduled_procedures=req.scheduled_procedures,
            patient_id=req.patient_id,
            carrier=req.carrier,
            member_id=req.member_id,
        )

        # Extract HIPAA adjustment reason codes from Change Healthcare response.
        # These live in benefitInformation[].AAA[].rejectReasonCode segments.
        raw_codes: list[int] = []
        for benefit in req.api_response.get("benefitInformation", []):
            for aaa in benefit.get("AAA", []):
                try:
                    raw_codes.append(int(aaa.get("rejectReasonCode", 0)))
                except (ValueError, TypeError):
                    pass

        # Deduplicate while preserving order
        seen: set[int] = set()
        unique_codes = [c for c in raw_codes if c and not (c in seen or seen.add(c))]

        return VerifyResponse(
            patient_id=breakdown.patient_id,
            carrier=breakdown.carrier,
            member_id=breakdown.member_id,
            completed_at=breakdown.completed_at,
            completeness_score=round(breakdown.completeness_score, 4),
            completeness_grade=breakdown.completeness_grade,
            fields={k: v for k, v in breakdown.fields.items() if v is not None},
            sources={k: v.value for k, v in breakdown.sources.items()},
            human_note=breakdown.human_note,
            warnings=breakdown.warnings,
            hipaa_code_actions=resolve_hipaa_codes(unique_codes),
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat", response_model=ChatResponse)
def payer_pal_chat(req: ChatRequest):
    """
    Payer Pal — answers staff questions about a patient's coverage
    strictly grounded in the Change Healthcare verification JSON.

    The system prompt forbids hallucination: the model may only cite
    facts present in coverage_json.  Uses the Anthropic Python SDK.
    API key is read from ANTHROPIC_API_KEY environment variable.
    """
    cov = req.coverage_json

    coverage_summary = f"""
PATIENT COVERAGE SNAPSHOT (source: Change Healthcare verification)
Patient ID : {req.patient_id}
Payer      : {cov.get('payer_name', 'Unknown')}
Plan status: {cov.get('plan_status', 'unknown')}
Verify status: {cov.get('verification_status', 'unknown')}
Annual max : ${(cov.get('annual_maximum_cents') or 0) / 100:.0f}
Remaining  : ${(cov.get('annual_remaining_cents') or 0) / 100:.0f}
Deductible : ${(cov.get('individual_deductible_cents') or 0) / 100:.0f}
Ded. met   : ${(cov.get('individual_deductible_met_cents') or 0) / 100:.0f}
Preventive : {cov.get('preventive', {})}
Restorative: {cov.get('restorative', {})}
Missing tooth clause: {cov.get('missing_tooth_clause', {})}
Action flags: {cov.get('action_flags', [])}
HIPAA codes: {cov.get('hipaa_codes', [])}
Warnings   : {cov.get('warnings', [])}
""".strip()

    system_prompt = (
        "You are Payer Pal, an AI assistant embedded in the Pulp dental insurance "
        "verification dashboard.\n\n"
        "STRICT RULES:\n"
        "1. Answer ONLY based on the coverage data provided. Do not invent or assume any values.\n"
        "2. If the data does not contain the answer, say so clearly and suggest the staff call the carrier.\n"
        "3. Be concise (2-4 sentences max). Write for busy front-desk staff, not engineers.\n"
        "4. Never quote dollar amounts that are not explicitly in the data.\n"
        "5. Never give medical or legal advice.\n\n"
        f"COVERAGE DATA:\n{coverage_summary}"
    )

    try:
        client = anthropic.Anthropic()   # reads ANTHROPIC_API_KEY from env
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": req.question}],
        )
        answer = message.content[0].text.strip()
        return ChatResponse(answer=answer, patient_id=req.patient_id)

    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e.status_code}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))