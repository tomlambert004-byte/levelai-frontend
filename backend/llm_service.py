"""
llm_service.py — Anthropic LLM Service for Pre-Authorization Letter Generation
===============================================================================
Uses the Anthropic Python SDK to call Claude and generate a professional,
clinically accurate Letter of Medical Necessity based on PMS-sourced data.

Environment variable required:
    ANTHROPIC_API_KEY — your Anthropic API key

Model: claude-opus-4-5 (configurable via LLM_MODEL env var)
"""

from __future__ import annotations
import os
import json
import anthropic


# ── Configuration ──────────────────────────────────────────────────────────────

LLM_MODEL   = os.getenv("LLM_MODEL", "claude-opus-4-5")
MAX_TOKENS  = int(os.getenv("LLM_MAX_TOKENS", "1500"))

# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior Dental Insurance Coordinator with 15 years of experience
writing Letters of Medical Necessity for pre-authorization requests. Your letters are
consistently approved by major dental payers including Delta Dental, Aetna, Guardian,
Cigna, MetLife, and United Healthcare.

Your task is to write a professional, persuasive, and clinically precise Letter of Medical
Necessity based strictly on the clinical data provided. Do not invent clinical details that
are not present in the data.

Letter requirements:
1. Professional business letter format (no markdown, no headers/bullets in the body)
2. Opening paragraph: patient demographics, date of service, procedure requested, treating provider
3. Clinical justification paragraph: cite specific clinical findings (pocket depths, bone measurements,
   diagnoses, test results) using exact values from the chart notes
4. Medical necessity argument: explain why the procedure is the appropriate, minimally invasive
   standard of care — reference applicable ADA, AAP, or AAE guidelines where relevant
5. Risk of non-treatment paragraph: describe documented consequences if the procedure is denied
6. Supporting documentation paragraph: list the attached records by filename
7. Professional closing with provider signature block
8. Tone: authoritative, factual, evidence-based — not emotional or pleading

Output only the letter text itself. No preamble, no commentary, no markdown.
"""

# ── Letter generation ──────────────────────────────────────────────────────────

def generate_preauth_letter(clinical_data: dict) -> str:
    """
    Calls Claude to generate a Letter of Medical Necessity.

    Args:
        clinical_data: dict from pms_service.get_patient_clinical_data()

    Returns:
        str — the generated letter text

    Raises:
        RuntimeError if the API call fails or ANTHROPIC_API_KEY is missing
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY environment variable is not set. "
            "Add it to your Railway service environment variables."
        )

    client = anthropic.Anthropic(api_key=api_key)

    # Format the clinical data into a structured prompt
    user_prompt = _build_user_prompt(clinical_data)

    message = client.messages.create(
        model=LLM_MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_prompt}
        ],
    )

    # Extract text from the response
    content = message.content
    if not content:
        raise RuntimeError("Claude returned an empty response")

    letter_text = "".join(
        block.text for block in content if hasattr(block, "text")
    ).strip()

    if not letter_text:
        raise RuntimeError("Claude returned no text content")

    return letter_text


def _build_user_prompt(data: dict) -> str:
    """Converts clinical data dict into a richly formatted prompt for Claude."""

    notes_formatted = "\n\n".join(
        f"  [{n['date']} — {n['provider']}]\n  {n['note']}"
        for n in data.get("clinical_notes", [])
    )

    history_formatted = "\n".join(
        f"  • {k.replace('_', ' ').title()}: {v}"
        for k, v in data.get("relevant_history", {}).items()
    )

    attachments_formatted = "\n".join(
        f"  • {f['filename']} — {f['description']}"
        for f in data.get("attached_files", [])
    )

    fee_dollars = data.get("estimated_fee_cents", 0) / 100
    coverage_pct = data.get("insurance_estimated_coverage_pct", 0)

    return f"""Please write a Letter of Medical Necessity for the following pre-authorization request.

=== PATIENT DEMOGRAPHICS ===
Name:           {data.get('patient_name')}
Date of Birth:  {data.get('date_of_birth')}
Member ID:      {data.get('member_id')}
Insurance:      {data.get('insurance_carrier')}
Group Number:   {data.get('group_number')}

=== PROCEDURE REQUESTED ===
Code:           {data.get('procedure_code')}
Description:    {data.get('procedure_description')}
Tooth Number(s):{', '.join(data.get('tooth_numbers', []))}
Treating Provider: {data.get('treating_provider')}
Facility:       {data.get('facility_name')}
Date of Service:{data.get('appointment_date')}
Estimated Fee:  ${fee_dollars:,.2f} (plan covers est. {coverage_pct}%)

=== CLINICAL NOTES FROM CHART ===
{notes_formatted}

=== RELEVANT PATIENT HISTORY ===
{history_formatted}

=== SUPPORTING DOCUMENTS ATTACHED ===
{attachments_formatted}

Based strictly on the above clinical data, write a complete Letter of Medical Necessity
addressed to the pre-authorization department of {data.get('insurance_carrier')}.
Use today's date. The letter should be ready to print and submit.
"""


# ── CLI demo ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from pms_service import get_patient_clinical_data

    patient_id     = sys.argv[1] if len(sys.argv) > 1 else "p4"
    procedure_code = sys.argv[2] if len(sys.argv) > 2 else "D6010"

    print(f"Fetching PMS data for {patient_id} / {procedure_code}...")
    clinical = get_patient_clinical_data(patient_id, procedure_code)
    if not clinical:
        print("No clinical data found.")
        sys.exit(1)

    print("Calling Claude to generate letter...")
    letter = generate_preauth_letter(clinical)
    print("\n" + "=" * 70)
    print(letter)
    print("=" * 70)
