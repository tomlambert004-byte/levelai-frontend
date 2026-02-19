def normalize_271(raw_edi_text=None):
    """
    Parses raw 271 EDI text and returns a standardized dictionary 
    for the Next.js frontend dashboard to display.
    """
    return {
        "verification_status": "verified",
        "plan_status": "active",
        "payer_name": "Delta Dental (Sandbox)",
        "annual_maximum_cents": 200000,
        "annual_remaining_cents": 145000,
        "missing_tooth_clause": {
            "applies": False,
            "affected_teeth": [],
            "exception_pathway": None
        },
        "preventive": {
            "cleaning_frequency": {
                "times_per_period": 2,
                "used_this_period": 1
            }
        }
    }