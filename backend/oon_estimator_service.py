"""
oon_estimator_service.py
========================
Out-of-Network (OON) Financial Estimator — Data Sourcing Waterfall

Takes patient eligibility context and executes a 4-step waterfall to
determine the most accurate OON allowable amount and patient responsibility.

Waterfall steps
---------------
Step 1  Network Check        — Is this payer in the provider's credentialing list?
                               If IN-network  → return contracted rate immediately.
                               If OUT-of-network → continue waterfall.

Step 2  Historical Scrubbing — Query mock ERA database for past OON allowables
                               for this Payer + Procedure Code combination.
                               If history exists  → use average allowed amount.
                               If no history     → continue to Step 3.

Step 3  RPA Scrape           — Simulate RPA bot logging into the payer portal
                               to scrape the MAC/UCR fee schedule for this code.
                               Always returns a simulated result as fallback.

Step 4  Calculations         — Compute estimated insurance payment and patient
                               responsibility using the allowable from Steps 2/3
                               plus remaining deductible and OON coverage %.

Usage
-----
    from oon_estimator_service import run_oon_waterfall

    result = run_oon_waterfall(
        patient_id="p7",
        procedure_code="D2750",
        office_fee=1450.00,
        provider_credentialing=["DELTA_PPO", "CIGNA", "AETNA_DMO", "GUARDIAN", "METLIFE"],
        payer_id="HUMANA",
        oon_coverage_pct=50,
        remaining_deductible=100.00,
    )
"""

import random
from dataclasses import dataclass, asdict
from typing import Optional


# ── Provider credentialing list (mock) ────────────────────────────────────────
# In production this would come from the practice management system or
# a credentialing database (CAQH, Council for Affordable Quality Healthcare).
DEFAULT_CREDENTIALING = [
    "DELTA_PPO",
    "CIGNA",
    "AETNA_DMO",
    "GUARDIAN",
    "METLIFE",
    "BCBS",
    "UHC",
]


# ── Mock ERA history database ─────────────────────────────────────────────────
# Keyed by (payer_id, procedure_code).
# Values are lists of historical allowed amounts (in dollars) from past ERAs.
ERA_HISTORY_DB: dict[tuple[str, str], list[float]] = {
    ("HUMANA",  "D2750"): [992.00, 975.00, 988.00, 1005.00, 962.00, 980.00, 978.00],
    ("HUMANA",  "D2391"): [320.00, 315.00, 328.00],
    ("HUMANA",  "D1110"): [85.00,  90.00,  88.00],
    ("HUMANA",  "D4341"): [198.00, 205.00, 202.00],
    ("TRICARE", "D2750"): [850.00, 860.00, 855.00],
    ("TRICARE", "D2391"): [290.00, 295.00],
    ("MEDICAID","D1110"): [55.00,  58.00,  57.00],
}

# MAC/UCR fee schedule — used by the RPA scraper as a lookup fallback.
# In production these would be scraped from payer portals.
RPA_MAC_SCHEDULE: dict[tuple[str, str], float] = {
    ("HUMANA",  "D2750"): 940.00,
    ("HUMANA",  "D2391"): 305.00,
    ("HUMANA",  "D1110"): 82.00,
    ("HUMANA",  "D4341"): 195.00,
    ("TRICARE", "D2750"): 840.00,
    ("MEDICAID","D1110"): 54.00,
}


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class WaterfallStep:
    step: int
    name: str
    status: str          # "complete" | "skipped" | "failed"
    result: str          # human-readable outcome description


@dataclass
class OONEstimateResult:
    network_status: str                      # "in_network" | "out_of_network"
    procedure_code: str
    office_fee: float
    allowable_amount: Optional[float]        # None if in-network (use contracted rate)
    contracted_rate: Optional[float]         # Set if in-network
    data_source: str                         # "contracted" | "historical_claims" | "rpa_scrape"
    data_source_label: str                   # Display string for UI
    oon_coverage_pct: float                  # e.g. 50.0 → 50%
    remaining_deductible: float
    estimated_insurance_payment: float
    patient_responsibility: float
    waterfall_steps: list


# ── Step 1: Network Check ─────────────────────────────────────────────────────

def step_network_check(
    payer_id: str,
    provider_credentialing: list[str],
) -> tuple[bool, WaterfallStep]:
    """
    Returns (is_in_network, step_record).
    """
    in_network = payer_id in provider_credentialing
    status_text = (
        f"In-Network — {payer_id} found in provider credentialing list"
        if in_network
        else f"Out-of-Network — {payer_id} not in provider credentialing list"
    )
    return in_network, WaterfallStep(
        step=1,
        name="Network Check",
        status="complete",
        result=status_text,
    )


# ── Step 2: Historical Scrubbing ──────────────────────────────────────────────

def step_historical_scrubbing(
    payer_id: str,
    procedure_code: str,
) -> tuple[Optional[float], WaterfallStep]:
    """
    Returns (avg_allowed_amount | None, step_record).
    """
    key = (payer_id, procedure_code)
    history = ERA_HISTORY_DB.get(key)

    if history:
        avg = round(sum(history) / len(history), 2)
        return avg, WaterfallStep(
            step=2,
            name="Historical Scrubbing",
            status="complete",
            result=(
                f"Found {len(history)} historical ERAs for "
                f"{procedure_code} / {payer_id} — avg allowed: ${avg:,.2f}"
            ),
        )

    return None, WaterfallStep(
        step=2,
        name="Historical Scrubbing",
        status="complete",
        result=f"No ERA history found for {procedure_code} / {payer_id} — escalating to RPA",
    )


# ── Step 3: RPA Scrape ────────────────────────────────────────────────────────

def step_rpa_scrape(
    payer_id: str,
    procedure_code: str,
) -> tuple[float, WaterfallStep]:
    """
    Simulates an RPA bot scraping the payer portal for the MAC/UCR fee.
    Always returns a value (never fails in sandbox mode).
    """
    key = (payer_id, procedure_code)
    mac = RPA_MAC_SCHEDULE.get(key)

    if mac is not None:
        # Simulate slight portal variance (±2%)
        variance = random.uniform(-0.02, 0.02)
        scraped = round(mac * (1 + variance), 2)
        source_note = f"Scraped MAC from {payer_id} portal: ${scraped:,.2f}"
    else:
        # Generic UCR fallback: 65% of office fee
        scraped = round(float("nan"), 2)   # placeholder — overridden below
        source_note = f"No MAC on file — using 65% UCR estimate"

    return mac or 0.0, WaterfallStep(
        step=3,
        name="RPA Scrape",
        status="complete",
        result=source_note,
    )


# ── Step 4: Calculations ──────────────────────────────────────────────────────

def step_calculate(
    office_fee: float,
    allowable_amount: float,
    oon_coverage_pct: float,
    remaining_deductible: float,
) -> tuple[float, float, WaterfallStep]:
    """
    Returns (estimated_insurance_payment, patient_responsibility, step_record).

    Formula:
        billable_to_insurance = max(0, allowable - remaining_deductible)
        insurance_pmt         = billable_to_insurance × (oon_coverage_pct / 100)
        patient_responsibility = office_fee - insurance_pmt
    """
    billable = max(0.0, allowable_amount - remaining_deductible)
    insurance_pmt = round(billable * (oon_coverage_pct / 100), 2)
    patient_resp  = round(office_fee - insurance_pmt, 2)

    calc_detail = (
        f"(${allowable_amount:,.2f} allowable − ${remaining_deductible:,.2f} deductible) "
        f"× {oon_coverage_pct:.0f}% = ${insurance_pmt:,.2f} est. insurance pmt"
    )

    return insurance_pmt, patient_resp, WaterfallStep(
        step=4,
        name="Calculation",
        status="complete",
        result=calc_detail,
    )


# ── Public API ────────────────────────────────────────────────────────────────

def run_oon_waterfall(
    patient_id: str,
    procedure_code: str,
    office_fee: float,
    provider_credentialing: Optional[list[str]] = None,
    payer_id: str = "UNKNOWN",
    oon_coverage_pct: float = 50.0,
    remaining_deductible: float = 0.0,
) -> dict:
    """
    Execute the full OON data sourcing waterfall and return a serialisable dict.

    Parameters
    ----------
    patient_id            : Patient identifier (for logging/audit)
    procedure_code        : ADA procedure code, e.g. "D2750"
    office_fee            : Practice's full fee in dollars, e.g. 1450.00
    provider_credentialing: List of payer_ids the provider is credentialed with
    payer_id              : The patient's payer identifier
    oon_coverage_pct      : OON coverage percentage from the 271 (e.g. 50 = 50%)
    remaining_deductible  : OON deductible still owed in dollars

    Returns
    -------
    dict representation of OONEstimateResult
    """
    if provider_credentialing is None:
        provider_credentialing = DEFAULT_CREDENTIALING

    steps: list[WaterfallStep] = []
    allowable_amount: Optional[float] = None
    data_source = "unknown"
    data_source_label = ""
    contracted_rate: Optional[float] = None

    # ── Step 1: Network Check ──────────────────────────────────────────────────
    in_network, s1 = step_network_check(payer_id, provider_credentialing)
    steps.append(s1)

    if in_network:
        # In-network: use a mock contracted rate (85% of office fee in sandbox)
        contracted_rate = round(office_fee * 0.85, 2)
        insurance_pmt   = round(contracted_rate * (oon_coverage_pct / 100), 2)
        patient_resp    = round(office_fee - insurance_pmt, 2)
        data_source       = "contracted"
        data_source_label = "✅ In-Network Contracted Rate"

        # Skip OON steps
        steps.append(WaterfallStep(2, "Historical Scrubbing", "skipped", "Not needed — plan is in-network"))
        steps.append(WaterfallStep(3, "RPA Scrape",           "skipped", "Not needed — plan is in-network"))
        steps.append(WaterfallStep(4, "Calculation",          "skipped", "Contracted rate used directly"))

        result = OONEstimateResult(
            network_status="in_network",
            procedure_code=procedure_code,
            office_fee=office_fee,
            allowable_amount=None,
            contracted_rate=contracted_rate,
            data_source=data_source,
            data_source_label=data_source_label,
            oon_coverage_pct=oon_coverage_pct,
            remaining_deductible=remaining_deductible,
            estimated_insurance_payment=insurance_pmt,
            patient_responsibility=patient_resp,
            waterfall_steps=[asdict(s) for s in steps],
        )
        return asdict(result)

    # ── OON path ──────────────────────────────────────────────────────────────

    # Step 2: Historical Scrubbing
    history_allowed, s2 = step_historical_scrubbing(payer_id, procedure_code)
    steps.append(s2)

    if history_allowed is not None:
        allowable_amount  = history_allowed
        data_source       = "historical_claims"
        data_source_label = "⚡ Sourced via Historical Claims Data"
        # Step 3 skipped
        steps.append(WaterfallStep(3, "RPA Scrape", "skipped", "Not needed — history data sufficient"))
    else:
        # Step 3: RPA Scrape
        rpa_allowed, s3 = step_rpa_scrape(payer_id, procedure_code)
        steps.append(s3)
        # Fallback if RPA also returns 0: use 65% UCR
        allowable_amount  = rpa_allowed if rpa_allowed > 0 else round(office_fee * 0.65, 2)
        data_source       = "rpa_scrape"
        data_source_label = "🤖 Sourced via RPA Portal Scrape"

    # Step 4: Calculate
    insurance_pmt, patient_resp, s4 = step_calculate(
        office_fee, allowable_amount, oon_coverage_pct, remaining_deductible
    )
    steps.append(s4)

    result = OONEstimateResult(
        network_status="out_of_network",
        procedure_code=procedure_code,
        office_fee=office_fee,
        allowable_amount=allowable_amount,
        contracted_rate=None,
        data_source=data_source,
        data_source_label=data_source_label,
        oon_coverage_pct=oon_coverage_pct,
        remaining_deductible=remaining_deductible,
        estimated_insurance_payment=insurance_pmt,
        patient_responsibility=patient_resp,
        waterfall_steps=[asdict(s) for s in steps],
    )
    return asdict(result)


# ── CLI demo ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json

    print("=== OON Waterfall Demo: Lisa Chen (p7) — D2750 Crown ===\n")
    out = run_oon_waterfall(
        patient_id="p7",
        procedure_code="D2750",
        office_fee=1450.00,
        payer_id="HUMANA",
        oon_coverage_pct=50.0,
        remaining_deductible=100.00,
    )
    print(json.dumps(out, indent=2))

    print("\n=== OON Waterfall Demo: Unknown payer — RPA fallback ===\n")
    out2 = run_oon_waterfall(
        patient_id="p_test",
        procedure_code="D2750",
        office_fee=1450.00,
        payer_id="SOME_UNKNOWN_OON_PAYER",
        oon_coverage_pct=40.0,
        remaining_deductible=200.00,
    )
    print(json.dumps(out2, indent=2))
