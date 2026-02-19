# =============================================================================
# clinical_scribe.py — AI Clinical Scribe (LLM Wrapper)
# =============================================================================
# This module is the single point of contact with the LLM (Anthropic Claude).
# It has one job: take raw, unstructured doctor's notes and transform them into
# a formally-worded Letter of Medical Necessity that satisfies insurance
# requirements (e.g. Missing Tooth Clause justification).
#
# DATA FLOW CONTEXT:
#   worker.py → generate_medical_necessity_letter(notes, code) → narrative str
#
# Why isolate this in its own module?
#   - Easy to swap LLM providers (Claude ↔ GPT-4) without touching the worker
#   - Easy to unit-test with mocked LLM responses
#   - Prompt engineering stays in one place
# =============================================================================

import os
import logging

import anthropic  # pip install anthropic
# If you prefer OpenAI, swap to: from openai import OpenAI

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System Prompt — the LLM's "job description" for every request.
# Keeping it here (not in worker.py) means prompt changes don't require
# touching the task orchestration logic.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You are an expert dental billing specialist. "
    "Take the provided raw clinical notes and write a formal, concise "
    "Letter of Medical Necessity for the requested procedure code. "
    "Focus only on clinical facts, periodontal health, and reasons for "
    "extraction to satisfy insurance requirements like the Missing Tooth Clause. "
    "Do not invent data."
)


def generate_medical_necessity_letter(
    raw_notes: str,
    procedure_code: str,
) -> str:
    """
    Call the Anthropic API to convert raw clinical notes into a formal
    Letter of Medical Necessity.

    Args:
        raw_notes:       Unstructured text from the dentist's charting system,
                         e.g. "Tooth #14 non-restorable, extracted 6 mos ago,
                         patient needs implant, perio stable"
        procedure_code:  CDT/CPT code for the requested procedure,
                         e.g. "D6010" (endosteal implant body).
                         Included in the user prompt so the LLM knows exactly
                         which procedure it is justifying.

    Returns:
        A clean narrative string ready to attach to the pre-auth submission.
        If the API call fails, raises an exception (caught by the Celery worker
        which will mark the PreAuthorization record as FAILED).
    """

    # -----------------------------------------------------------------------
    # Build the Anthropic client.
    # The API key is read from the environment — never hard-code secrets.
    # Set ANTHROPIC_API_KEY in your .env or deployment secrets manager.
    # -----------------------------------------------------------------------
    client = anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"]
    )

    # -----------------------------------------------------------------------
    # Construct the user message.
    # We inject both the procedure code and the raw notes so the LLM has all
    # the context it needs in a single turn (no back-and-forth needed).
    # -----------------------------------------------------------------------
    user_message = (
        f"Procedure Code: {procedure_code}\n\n"
        f"Raw Clinical Notes:\n{raw_notes}\n\n"
        "Please write the formal Letter of Medical Necessity now."
    )

    logger.info(
        "Calling Claude API for pre-auth narrative. "
        "procedure_code=%s notes_length=%d chars",
        procedure_code,
        len(raw_notes),
    )

    # -----------------------------------------------------------------------
    # API call — claude-sonnet-4-6 is the recommended balance of quality
    # and speed for clinical document generation.
    # max_tokens=1024 is plenty for a concise letter; adjust upward if you
    # find the output being truncated on complex cases.
    # -----------------------------------------------------------------------
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_message}
        ],
    )

    # -----------------------------------------------------------------------
    # Extract the text content from the response.
    # message.content is a list of content blocks; we want the first text block.
    # -----------------------------------------------------------------------
    narrative = message.content[0].text.strip()

    logger.info(
        "Claude returned narrative. length=%d chars stop_reason=%s",
        len(narrative),
        message.stop_reason,
    )

    return narrative


# ---------------------------------------------------------------------------
# Quick sanity-check — run this file directly to test your API key works:
#   ANTHROPIC_API_KEY=sk-... python clinical_scribe.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    test_notes = (
        "Tooth #14 was deemed non-restorable due to extensive decay involving "
        "the furcation. Extraction was performed 6 months ago. The patient "
        "presents with adequate bone height (8mm) and width for implant "
        "placement. Periodontal health is stable with probing depths of 2-3mm "
        "throughout. Patient has maintained good oral hygiene compliance."
    )

    result = generate_medical_necessity_letter(
        raw_notes=test_notes,
        procedure_code="D6010",
    )

    print("\n--- Generated Letter of Medical Necessity ---")
    print(result)
