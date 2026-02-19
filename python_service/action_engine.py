from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

class MTCResult(BaseModel):
    is_risk: bool = False
    needs_scrubbing: bool = False
    message: Optional[str] = None

class MTCValidator:
    # CDT Codes that are sensitive to the Missing Tooth Clause
    PROSTHETIC_CODES = {
        # Implants
        "D6010", "D6058", "D6056", "D6057",
        # Bridges (Retainers and Pontics)
        "D6210", "D6240", "D6245", "D6740", "D6750",
        # Dentures
        "D5110", "D5120", "D5211", "D5212"
    }

    @classmethod
    def evaluate(cls, raw_benefits: dict, treatment_plan_codes: List[str], coverage_start_date: str) -> MTCResult:
        """
        Logic to determine if a Missing Tooth Clause risk exists.
        """
        # 1. Check if the treatment plan contains any prosthetic codes
        has_prosthetic = any(code in cls.PROSTHETIC_CODES for code in treatment_plan_codes)
        
        # 2. Extract MTC status from insurance data (JSON from Zuub/Eligible)
        # Often found in 'additionalInformation' or 'description' fields
        has_mtc_in_api = raw_benefits.get("has_missing_tooth_clause")
        
        # If the API is silent/null on MTC, we need the bot to investigate
        if has_mtc_in_api is None and has_prosthetic:
            return MTCResult(
                is_risk=True, 
                needs_scrubbing=True, 
                message="MTC status unknown. Triggering bot to scrub portal for exclusions."
            )

        # 3. If MTC is confirmed and a prosthetic is planned, flag the risk
        if has_mtc_in_api and has_prosthetic:
            return MTCResult(
                is_risk=True,
                needs_scrubbing=False,
                message=f"CRITICAL: Plan has MTC. Prosthetic planned for patient with {coverage_start_date} effective date. Verify extraction date."
            )

        return MTCResult(is_risk=False, message="No MTC risk detected.")