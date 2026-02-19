"""
test_normalizer.py
Runs all fixture files through the normalizer and validates the output
matches expected values. No external dependencies — run with plain Python.

Usage:
    python test_normalizer.py
    python test_normalizer.py --verbose
"""

import json
import sys
import os
from pathlib import Path
from normalizer import normalize_271

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# ─── Expected outcomes per fixture ───────────────────────────────────────────
# Define what the normalizer MUST produce for each fixture.
# Any field listed here is a hard assertion — test fails if it doesn't match.

EXPECTATIONS = {
    "271_active_clean": {
        "verification_status":          "verified",
        "plan_status":                  "active",
        "payer_name":                   "Delta Dental PPO",
        "annual_maximum_cents":         200000,
        "annual_remaining_cents":       145000,
        "individual_deductible_cents":  5000,
        "individual_deductible_met_cents": 5000,
        "action_flags":                 [],
        # nested checks
        "_nested": {
            "preventive.coverage_pct":               100,
            "preventive.cleaning_frequency.times_per_period": 2,
            "preventive.cleaning_frequency.used_this_period": 1,
            "restorative.coverage_pct":              80,
            "restorative.composite_posterior_downgrade": False,
            "missing_tooth_clause.applies":          False,
        }
    },

    "271_frequency_limit": {
        "verification_status":          "action_required",
        "plan_status":                  "active",
        "annual_remaining_cents":       88000,
        "_action_flags_include":        ["frequency_limit"],
        "_nested": {
            "preventive.cleaning_frequency.used_this_period":   2,
            "preventive.cleaning_frequency.times_per_period":   2,
            "preventive.cleaning_frequency.next_eligible_date": "2027-01-01",
        }
    },

    "271_missing_tooth_clause": {
        "verification_status":          "action_required",
        "plan_status":                  "active",
        "individual_deductible_met_cents": 0,
        "_action_flags_include":        ["missing_tooth_clause", "pre_auth_required"],
        "_nested": {
            "missing_tooth_clause.applies":           True,
            "missing_tooth_clause.affected_teeth":    ["#14"],
        }
    },

    "271_inactive_plan": {
        "verification_status":          "inactive",
        "plan_status":                  "inactive",
        "annual_remaining_cents":       0,
        "_action_flags_include":        ["plan_inactive"],
        "_nested": {
            "missing_tooth_clause.applies": False,
        }
    },

    "271_composite_downgrade_low_max": {
        "verification_status":          "action_required",
        "plan_status":                  "active",
        "annual_remaining_cents":       22000,
        "_action_flags_include":        ["composite_downgrade", "annual_max_low"],
        "_nested": {
            "restorative.composite_posterior_downgrade": True,
            "missing_tooth_clause.applies":              False,
        }
    },

    "271_active_deductible_not_met": {
        "verification_status":          "verified",
        "plan_status":                  "active",
        "annual_remaining_cents":       145000,
        "individual_deductible_cents":  5000,
        "individual_deductible_met_cents": 0,
        "action_flags":                 [],
        "_nested": {
            "restorative.composite_posterior_downgrade": False,
            "missing_tooth_clause.applies":              False,
        }
    },
}


# ─── Test runner ──────────────────────────────────────────────────────────────

def get_nested(d: dict, dotpath: str):
    """Traverse a dot-separated path through nested dicts."""
    parts = dotpath.split(".")
    cur = d
    for part in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def run_tests(verbose=False) -> bool:
    passed = 0
    failed = 0
    errors = 0

    fixture_files = sorted(FIXTURES_DIR.glob("*.json"))
    if not fixture_files:
        print("❌ No fixture files found in ./fixtures/")
        return False

    print(f"\n{'='*60}")
    print(f"  Pulp AI — 271 Normalizer Test Suite")
    print(f"  {len(fixture_files)} fixtures · {len(EXPECTATIONS)} with assertions")
    print(f"{'='*60}\n")

    for fixture_path in fixture_files:
        fixture_id = fixture_path.stem
        expected   = EXPECTATIONS.get(fixture_id)

        try:
            with open(fixture_path) as f:
                raw = json.load(f)
        except Exception as e:
            print(f"  ❌ LOAD ERROR  {fixture_id}: {e}")
            errors += 1
            continue

        try:
            result = normalize_271(raw)
        except Exception as e:
            print(f"  ❌ PARSE ERROR {fixture_id}: {e}")
            errors += 1
            continue

        if not expected:
            print(f"  ⚠  SKIP        {fixture_id} — no assertions defined")
            continue

        test_failures = []

        # Check top-level fields
        for field, exp_val in expected.items():
            if field.startswith("_"):
                continue
            got = result.get(field)
            if got != exp_val:
                test_failures.append(
                    f"    {field}: expected {repr(exp_val)}, got {repr(got)}"
                )

        # Check _action_flags_include (subset check, not exact)
        if "_action_flags_include" in expected:
            actual_flags = result.get("action_flags", [])
            for flag in expected["_action_flags_include"]:
                if flag not in actual_flags:
                    test_failures.append(
                        f"    action_flags: expected '{flag}' in {actual_flags}"
                    )

        # Check nested fields
        for dotpath, exp_val in expected.get("_nested", {}).items():
            got = get_nested(result, dotpath)
            if got != exp_val:
                test_failures.append(
                    f"    {dotpath}: expected {repr(exp_val)}, got {repr(got)}"
                )

        desc = raw.get("_description", "")
        if test_failures:
            print(f"  ❌ FAIL  {fixture_id}")
            print(f"          {desc}")
            for f in test_failures:
                print(f)
            print()
            failed += 1
        else:
            status = "✅ PASS"
            print(f"  {status}  {fixture_id}")
            if verbose:
                print(f"          {desc}")
                print(f"          status={result['verification_status']}  "
                      f"remaining=${result.get('annual_remaining_cents', 0)//100}  "
                      f"flags={result.get('action_flags', [])}")
            passed += 1

    print(f"\n{'─'*60}")
    print(f"  Results: {passed} passed · {failed} failed · {errors} errors")
    print(f"{'─'*60}\n")

    if failed == 0 and errors == 0:
        print("  🟢 All tests passed. Normalizer integrity confirmed.\n")
        return True
    else:
        print("  🔴 Some tests failed. Review normalizer logic.\n")
        return False


if __name__ == "__main__":
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    success = run_tests(verbose=verbose)
    sys.exit(0 if success else 1)
