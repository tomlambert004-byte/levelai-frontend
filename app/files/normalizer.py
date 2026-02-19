"""
normalizer.py
Maps raw 271 response JSON (from clearinghouse or fixture file) to the
normalized schema that PulpMain's frontend expects.

Usage:
    from normalizer import normalize_271
    result = normalize_271(raw_271_json)
"""

from typing import Optional
from datetime import date, datetime


# ─── Output schema (matches what page.jsx expects) ───────────────────────────

def normalize_271(raw: dict) -> dict:
    """
    Takes a raw 271 JSON response (clearinghouse or fixture)
    and returns a normalized dict matching PulpMain's frontend schema.
    """
    coverage  = raw.get("coverage", {})
    benefits  = raw.get("benefits", {})
    payer     = raw.get("payer", {})
    sub       = raw.get("subscriber", {})

    plan_status = coverage.get("plan_status", "unknown")

    # ── Annual max ────────────────────────────────────────────────────────────
    yr_max     = benefits.get("calendar_year_maximum", {})
    annual_max = yr_max.get("amount_cents")
    annual_rem = yr_max.get("remaining_cents")

    # ── Deductible ────────────────────────────────────────────────────────────
    ded        = benefits.get("deductible", {})
    ded_ind    = ded.get("individual_cents")
    ded_met    = ded.get("met_cents", 0)

    # ── Preventive ────────────────────────────────────────────────────────────
    prev       = benefits.get("preventive", {})
    prev_freq  = prev.get("frequency", {})
    clean_freq = prev_freq.get("cleanings", {})
    bw_freq    = prev_freq.get("bitewing_xrays", {})

    preventive_out = {
        "coverage_pct":        prev.get("coverage_pct"),
        "copay_cents":         prev.get("copay_cents"),
        "deductible_applies":  prev.get("deductible_applies", False),
        "cleaning_frequency": {
            "times_per_period":   clean_freq.get("times_per_period", 2),
            "used_this_period":   clean_freq.get("used_this_period", 0),
            "period":             clean_freq.get("period", "calendar_year"),
            "last_service_date":  clean_freq.get("last_service_date"),
            "next_eligible_date": clean_freq.get("next_eligible_date"),
        } if clean_freq else None,
        "bitewing_frequency": {
            "times_per_period":   bw_freq.get("times_per_period", 1),
            "used_this_period":   bw_freq.get("used_this_period", 0),
            "next_eligible_date": bw_freq.get("next_eligible_date"),
        } if bw_freq else None,
    }

    # ── Restorative ───────────────────────────────────────────────────────────
    basic  = benefits.get("basic_restorative", {})
    major  = benefits.get("major_restorative", {})
    # Use basic pct if available, fall back to major, then None
    rest_cov_pct = basic.get("coverage_pct") or major.get("coverage_pct")

    restorative_out = {
        "coverage_pct":                rest_cov_pct,
        "copay_cents":                 basic.get("copay_cents"),
        "deductible_applies":          basic.get("deductible_applies", True),
        "composite_posterior_downgrade": basic.get("composite_posterior_downgrade", False),
        "composite_posterior_note":    basic.get("composite_posterior_downgrade_note"),
        "crown_waiting_period_months": major.get("waiting_period_months", 0),
    }

    # ── Missing Tooth Clause ──────────────────────────────────────────────────
    mtc     = benefits.get("missing_tooth_clause", {})
    mtc_out = {
        "applies":            mtc.get("applies", False),
        "affected_teeth":     mtc.get("affected_teeth", []),
        "excluded_services":  mtc.get("excluded_services", []),
        "exception_pathway":  mtc.get("exception_pathway"),
        "extraction_date":    mtc.get("extraction_date_on_file"),
        "coverage_begin":     coverage.get("plan_begin_date"),
    }

    # ── Action flags ──────────────────────────────────────────────────────────
    action_flags = _derive_action_flags(
        plan_status, annual_rem, ded_met, ded_ind,
        clean_freq, mtc_out, basic, major
    )

    verification_status = _derive_verification_status(plan_status, action_flags)

    return {
        "verification_status":          verification_status,
        "plan_status":                  plan_status,
        "payer_name":                   payer.get("name"),
        "payer_id":                     payer.get("payer_id"),
        "insurance_type":               coverage.get("insurance_type"),
        "in_network":                   coverage.get("in_network", True),
        "plan_begin_date":              coverage.get("plan_begin_date"),
        "plan_end_date":                coverage.get("plan_end_date"),
        "termination_reason":           coverage.get("termination_reason"),
        "annual_maximum_cents":         annual_max,
        "annual_used_cents":            yr_max.get("used_cents"),
        "annual_remaining_cents":       annual_rem,
        "individual_deductible_cents":  ded_ind,
        "individual_deductible_met_cents": ded_met,
        "family_deductible_cents":      ded.get("family_cents"),
        "family_deductible_met_cents":  ded.get("family_met_cents"),
        "deductible_waived_for":        ded.get("waived_for", []),
        "preventive":                   preventive_out,
        "restorative":                  restorative_out,
        "missing_tooth_clause":         mtc_out,
        "action_flags":                 action_flags,
        "subscriber": {
            "member_id":   sub.get("member_id"),
            "first_name":  sub.get("first_name"),
            "last_name":   sub.get("last_name"),
            "dob":         sub.get("date_of_birth"),
            "group":       sub.get("group_number"),
            "plan_name":   sub.get("plan_name"),
        },
        "_fixture_id":   raw.get("_fixture_id"),
        "_normalized_at": datetime.utcnow().isoformat(),
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _derive_action_flags(
    plan_status, annual_rem, ded_met, ded_ind,
    clean_freq, mtc, basic, major
) -> list[str]:
    flags = []

    if plan_status != "active":
        flags.append("plan_inactive")
        return flags  # no point checking benefits on inactive plan

    if mtc.get("applies"):
        flags.append("missing_tooth_clause")
        if mtc.get("excluded_services"):
            flags.append("pre_auth_required")

    if clean_freq:
        used  = clean_freq.get("used_this_period", 0)
        total = clean_freq.get("times_per_period", 2)
        if used >= total:
            flags.append("frequency_limit")

    if annual_rem is not None and annual_rem == 0:
        flags.append("annual_max_exhausted")
    elif annual_rem is not None and annual_rem < 30000:
        flags.append("annual_max_low")

    if basic.get("composite_posterior_downgrade"):
        flags.append("composite_downgrade")

    wait = major.get("waiting_period_months", 0)
    if wait and wait > 0:
        flags.append("waiting_period_active")

    return flags


def _derive_verification_status(plan_status: str, action_flags: list[str]) -> str:
    if plan_status != "active":
        return "inactive"
    critical_flags = {
        "plan_inactive", "missing_tooth_clause", "pre_auth_required",
        "frequency_limit", "annual_max_exhausted", "annual_max_low",
        "composite_downgrade", "waiting_period_active"
    }
    if any(f in critical_flags for f in action_flags):
        return "action_required"
    return "verified"
