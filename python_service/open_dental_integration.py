"""
Pulp — Open Dental Integration Module
======================================
Connects Pulp to a dental office's Open Dental installation and writes
verification results directly into the patient's chart.

Writes:
  1. AI verification note → Patient Notes (with timestamp)
  2. Remaining insurance maximum → InsPlan.AnnualMax
  3. Deductible met amount → PatPlan deductible fields
  4. Triage color flag → Patient.AddrNote color tag

Two connection modes:
  - API mode (recommended): Uses Open Dental's REST API (v21.1+)
  - MySQL mode (fallback):   Direct database connection for older installs

Setup for the dental office:
  1. In Open Dental: Setup → API → Enable API → copy API key
  2. In Pulp settings page: enter their API key + server address
  3. Pulp stores it encrypted in its own database per-office

Usage:
  from open_dental_integration import OpenDentalClient

  client = OpenDentalClient.from_config(office_config)
  client.write_verification(patient_id, breakdown, triage)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

log = logging.getLogger("pulp.opendental")


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — CONFIG & CONNECTION MODES
# ══════════════════════════════════════════════════════════════════════════════

class ConnectionMode(str, Enum):
    API   = "api"    # Open Dental REST API (v21.1+) — recommended
    MYSQL = "mysql"  # Direct MySQL — older installs or on-premise servers


@dataclass
class OpenDentalConfig:
    """
    Stored per-office in Pulp's database.
    The dental office enters these once in Pulp's Settings page.

    API mode fields:
      api_key         : Generated in Open Dental → Setup → API
      server_url      : e.g. "http://192.168.1.50:8040" (local)
                        or  "https://api.opendental.com" (cloud)

    MySQL mode fields:
      mysql_host      : IP address of the Open Dental server
      mysql_port      : Usually 3306
      mysql_database  : Usually "opendental"
      mysql_user      : Read/write DB user
      mysql_password  : DB password
    """
    mode: ConnectionMode
    office_id: str           # Pulp's internal office identifier

    # API mode
    api_key: str    = ""
    server_url: str = ""

    # MySQL mode
    mysql_host:     str = ""
    mysql_port:     int = 3306
    mysql_database: str = "opendental"
    mysql_user:     str = ""
    mysql_password: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "OpenDentalConfig":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — TRIAGE COLOR MAPPING
# ══════════════════════════════════════════════════════════════════════════════

# Open Dental uses integer color values for patient flags
# These map to the colored squares visible in the appointment book
TRIAGE_COLORS = {
    "CLEAR":    {"name": "Green",  "hex": "#16A34A", "od_color": 5287936},   # Green
    "WARNING":  {"name": "Yellow", "hex": "#D97706", "od_color": 49151},     # Yellow/Amber
    "CRITICAL": {"name": "Red",    "hex": "#DC2626", "od_color": 255},       # Red
}


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — NOTE FORMATTER
# ══════════════════════════════════════════════════════════════════════════════

def format_chart_note(breakdown: dict, triage_level: str, triage_warnings: list[str]) -> str:
    """
    Formats the Pulp Smart Breakdown into a concise chart note
    that looks clean inside Open Dental's patient notes field.

    Keeps it under 500 chars so it's readable at a glance in the chart.
    Full detail is available in Pulp itself.
    """
    now = datetime.now().strftime("%m/%d/%Y %I:%M %p")
    fields = breakdown.get("fields", {})
    grade  = breakdown.get("completeness_grade", "?")

    remaining  = fields.get("annual_maximum_remaining")
    deductible = fields.get("individual_deductible")
    ded_met    = fields.get("deductible_met")
    cov_basic  = fields.get("coverage_pct.basic")
    cov_major  = fields.get("coverage_pct.major")

    def dollars(cents):
        if cents is None: return "Unknown"
        return f"${cents / 100:,.0f}"

    def pct(val):
        if val is None: return "Unknown"
        return f"{val}%"

    triage_icon = {"CLEAR": "✓", "WARNING": "⚠", "CRITICAL": "🚨"}.get(triage_level, "?")

    lines = [
        f"── Pulp AI Verification [{now}] ──",
        f"Carrier: {breakdown.get('carrier', 'Unknown')} | Triage: {triage_icon} {triage_level} | Data: {grade}",
        f"Remaining Max: {dollars(remaining)} | Deductible: {dollars(deductible)} | Met: {dollars(ded_met)}",
        f"Coverage: {pct(cov_basic)} basic · {pct(cov_major)} major",
    ]

    if triage_warnings:
        lines.append(f"Flags: {' · '.join(triage_warnings[:2])}")

    lines.append("── Auto-verified by Pulp ──")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — OPEN DENTAL API CLIENT
# ══════════════════════════════════════════════════════════════════════════════

class OpenDentalAPIClient:
    """
    Communicates with Open Dental's REST API.
    Available in Open Dental v21.1 and newer.

    API docs: https://www.opendental.com/site/apiguide.html

    Key endpoints used:
      GET  /patients/{patNum}              — fetch patient record
      PUT  /patients/{patNum}              — update patient fields (color flag)
      POST /patientnotes                   — create a new chart note
      GET  /insplans?PatNum={patNum}       — get insurance plan
      PUT  /insplans/{PlanNum}             — update annual max
      GET  /patplans?PatNum={patNum}       — get patient plan (deductible)
      PUT  /patplans/{PatPlanNum}          — update deductible met
    """

    def __init__(self, config: OpenDentalConfig):
        self.config = config
        self.base   = config.server_url.rstrip("/")
        self.headers = {
            "Authorization": f"ODFHIR {config.api_key}",
            "Content-Type":  "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self.base}/api/v1{path}"

    async def _get(self, path: str) -> dict:
        """
        Production: replace with aiohttp or httpx async call.
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(self._url(path), headers=self.headers)
            r.raise_for_status()
            return r.json()
        """
        log.info("[OD API] GET %s", path)
        # STUB — replace with real HTTP call above
        return {}

    async def _put(self, path: str, data: dict) -> dict:
        """
        Production: replace with aiohttp or httpx async call.
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.put(self._url(path), headers=self.headers, json=data)
            r.raise_for_status()
            return r.json()
        """
        log.info("[OD API] PUT %s → %s", path, json.dumps(data))
        # STUB — replace with real HTTP call above
        return {}

    async def _post(self, path: str, data: dict) -> dict:
        """
        Production: replace with aiohttp or httpx async call.
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.post(self._url(path), headers=self.headers, json=data)
            r.raise_for_status()
            return r.json()
        """
        log.info("[OD API] POST %s → %s", path, json.dumps(data))
        # STUB — replace with real HTTP call above
        return {}

    # ── Write operations ──────────────────────────────────────────────────────

    async def write_chart_note(self, pat_num: int, note_text: str) -> dict:
        """
        Creates a new entry in the patient's chart notes.
        Appears in Open Dental under Account → Notes.
        """
        payload = {
            "PatNum":   pat_num,
            "Note":     note_text,
            "NoteDate": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "UserNum":  0,   # 0 = system / automated entry
        }
        result = await self._post("/patientnotes", payload)
        log.info("Chart note written for PatNum %s", pat_num)
        return result

    async def update_insurance_remaining(
        self, pat_num: int, remaining_cents: int, annual_max_cents: int
    ) -> dict:
        """
        Updates the AnnualMax and remaining benefit on the patient's
        insurance plan record.
        """
        plans = await self._get(f"/insplans?PatNum={pat_num}")
        plan_list = plans if isinstance(plans, list) else plans.get("InsPlans", [])
        if not plan_list:
            log.warning("No insurance plan found for PatNum %s", pat_num)
            return {}

        plan_num = plan_list[0].get("PlanNum")
        payload = {
            "AnnualMax":       annual_max_cents / 100,    # OD stores as dollars
            "AnnualMaxRemain": remaining_cents / 100,
        }
        result = await self._put(f"/insplans/{plan_num}", payload)
        log.info("Insurance max updated for PatNum %s → $%s remaining", pat_num, remaining_cents / 100)
        return result

    async def update_deductible_met(
        self, pat_num: int, deductible_cents: int, deductible_met_cents: int
    ) -> dict:
        """
        Updates the deductible and deductible-met on the patient's
        PatPlan record (the link between patient and insurance plan).
        """
        patplans = await self._get(f"/patplans?PatNum={pat_num}")
        plan_list = patplans if isinstance(patplans, list) else patplans.get("PatPlans", [])
        if not plan_list:
            log.warning("No PatPlan found for PatNum %s", pat_num)
            return {}

        pat_plan_num = plan_list[0].get("PatPlanNum")
        payload = {
            "Deductible":    deductible_cents / 100,
            "DeductibleMet": deductible_met_cents / 100,
        }
        result = await self._put(f"/patplans/{pat_plan_num}", payload)
        log.info("Deductible updated for PatNum %s → met $%s", pat_num, deductible_met_cents / 100)
        return result

    async def set_triage_color(self, pat_num: int, triage_level: str) -> dict:
        """
        Sets the patient's color flag in Open Dental's appointment book.
        Green = Clear, Yellow = Warning, Red = Critical.
        Visible as a colored square next to the patient's name.
        """
        color_info = TRIAGE_COLORS.get(triage_level, TRIAGE_COLORS["WARNING"])
        payload = {
            "AddrNote": f"Pulp Triage: {triage_level}",
            "PreferRecallMethod": color_info["od_color"],  # OD color integer
        }
        result = await self._put(f"/patients/{pat_num}", payload)
        log.info("Triage color set for PatNum %s → %s (%s)", pat_num, triage_level, color_info["name"])
        return result


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — MYSQL CLIENT (fallback for older Open Dental installs)
# ══════════════════════════════════════════════════════════════════════════════

class OpenDentalMySQLClient:
    """
    Direct MySQL connection to Open Dental's database.
    Use this when the office is on Open Dental < v21.1 or
    when the API is not enabled.

    Requires: pip install mysql-connector-python

    Key tables:
      patient        — main patient record (AddrNote, PatStatus, etc.)
      patientnote    — chart notes
      insplan        — insurance plan (AnnualMax)
      patplan        — patient-plan link (deductible)
      benefit        — individual benefit rows (frequency limits, coverage pct)
    """

    def __init__(self, config: OpenDentalConfig):
        self.config = config
        self._conn  = None

    def connect(self):
        """
        Establish MySQL connection.
        Production: wrap in try/except and handle reconnection.

        import mysql.connector
        self._conn = mysql.connector.connect(
            host     = self.config.mysql_host,
            port     = self.config.mysql_port,
            database = self.config.mysql_database,
            user     = self.config.mysql_user,
            password = self.config.mysql_password,
        )
        log.info("MySQL connected to Open Dental at %s", self.config.mysql_host)
        """
        log.info("[MySQL STUB] Would connect to %s:%s/%s",
                 self.config.mysql_host, self.config.mysql_port, self.config.mysql_database)

    def write_chart_note(self, pat_num: int, note_text: str) -> None:
        """
        Inserts a row into the patientnote table.

        Production SQL:
        cursor = self._conn.cursor()
        cursor.execute(
            "INSERT INTO patientnote (PatNum, Note, NoteDate, UserNum) "
            "VALUES (%s, %s, NOW(), 0)",
            (pat_num, note_text)
        )
        self._conn.commit()
        """
        log.info("[MySQL STUB] INSERT patientnote for PatNum %s", pat_num)
        log.info("[MySQL STUB] Note: %s", note_text[:80] + "…")

    def update_insurance_remaining(
        self, pat_num: int, remaining_cents: int, annual_max_cents: int
    ) -> None:
        """
        Updates the insplan table for this patient.

        Production SQL:
        cursor = self._conn.cursor()
        cursor.execute(
            "UPDATE insplan ip "
            "JOIN patplan pp ON pp.PlanNum = ip.PlanNum "
            "SET ip.AnnualMax = %s "
            "WHERE pp.PatNum = %s",
            (annual_max_cents / 100, pat_num)
        )
        self._conn.commit()
        """
        log.info("[MySQL STUB] UPDATE insplan AnnualMax for PatNum %s → $%s",
                 pat_num, annual_max_cents / 100)

    def update_deductible_met(
        self, pat_num: int, deductible_cents: int, deductible_met_cents: int
    ) -> None:
        """
        Updates deductible fields in the patplan table.

        Production SQL:
        cursor = self._conn.cursor()
        cursor.execute(
            "UPDATE patplan SET DeductAmt = %s, DeductAmtMet = %s "
            "WHERE PatNum = %s",
            (deductible_cents / 100, deductible_met_cents / 100, pat_num)
        )
        self._conn.commit()
        """
        log.info("[MySQL STUB] UPDATE patplan deductible for PatNum %s → met $%s",
                 pat_num, deductible_met_cents / 100)

    def set_triage_color(self, pat_num: int, triage_level: str) -> None:
        """
        Sets a color code on the patient record.
        Visible in the appointment book as a colored indicator.

        Production SQL:
        color = TRIAGE_COLORS.get(triage_level, TRIAGE_COLORS["WARNING"])["od_color"]
        cursor = self._conn.cursor()
        cursor.execute(
            "UPDATE patient SET AddrNote = %s WHERE PatNum = %s",
            (f'Pulp:{triage_level}', pat_num)
        )
        self._conn.commit()
        """
        color = TRIAGE_COLORS.get(triage_level, {}).get("name", "Unknown")
        log.info("[MySQL STUB] UPDATE patient color for PatNum %s → %s (%s)",
                 pat_num, triage_level, color)

    def disconnect(self):
        """if self._conn: self._conn.close()"""
        log.info("[MySQL STUB] Disconnected")


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — UNIFIED CLIENT (auto-selects API vs MySQL)
# ══════════════════════════════════════════════════════════════════════════════

class OpenDentalClient:
    """
    The single class your application uses.
    Automatically uses API mode or MySQL mode based on the office config.

    Usage:
      config  = OpenDentalConfig(mode=ConnectionMode.API, ...)
      client  = OpenDentalClient(config)
      result  = await client.write_verification(
                    od_pat_num = 1234,
                    breakdown  = smart_breakdown_dict,
                    triage_level   = "WARNING",
                    triage_warnings = ["Deductible not met", "Crown frequency limit"]
                )
    """

    def __init__(self, config: OpenDentalConfig):
        self.config = config
        if config.mode == ConnectionMode.API:
            self._api = OpenDentalAPIClient(config)
            self._db  = None
        else:
            self._api = None
            self._db  = OpenDentalMySQLClient(config)
            self._db.connect()

    @classmethod
    def from_config(cls, config_dict: dict) -> "OpenDentalClient":
        config = OpenDentalConfig.from_dict(config_dict)
        return cls(config)

    async def write_verification(
        self,
        od_pat_num: int,
        breakdown: dict,
        triage_level: str,
        triage_warnings: list[str],
    ) -> dict[str, Any]:
        """
        Master write method — calls all four write operations in order:
          1. Chart note
          2. Insurance remaining max
          3. Deductible met
          4. Triage color flag

        Returns a summary of what was written.
        """
        fields    = breakdown.get("fields", {})
        remaining = fields.get("annual_maximum_remaining")
        ann_max   = fields.get("annual_maximum")
        deduct    = fields.get("individual_deductible")
        ded_met   = fields.get("deductible_met")

        note_text = format_chart_note(breakdown, triage_level, triage_warnings)
        written   = {}

        log.info("Writing verification to Open Dental — PatNum %s | Triage: %s", od_pat_num, triage_level)

        if self._api:
            # ── API mode ──────────────────────────────────────────────────────
            written["chart_note"] = await self._api.write_chart_note(od_pat_num, note_text)

            if remaining is not None and ann_max is not None:
                written["insurance_max"] = await self._api.update_insurance_remaining(
                    od_pat_num, remaining, ann_max
                )

            if deduct is not None and ded_met is not None:
                written["deductible"] = await self._api.update_deductible_met(
                    od_pat_num, deduct, ded_met
                )

            written["triage_color"] = await self._api.set_triage_color(od_pat_num, triage_level)

        else:
            # ── MySQL mode ────────────────────────────────────────────────────
            self._db.write_chart_note(od_pat_num, note_text)
            written["chart_note"] = True

            if remaining is not None and ann_max is not None:
                self._db.update_insurance_remaining(od_pat_num, remaining, ann_max)
                written["insurance_max"] = True

            if deduct is not None and ded_met is not None:
                self._db.update_deductible_met(od_pat_num, deduct, ded_met)
                written["deductible"] = True

            self._db.set_triage_color(od_pat_num, triage_level)
            written["triage_color"] = True

        log.info("Write-back complete for PatNum %s — wrote: %s", od_pat_num, list(written.keys()))
        return {
            "od_pat_num":  od_pat_num,
            "triage":      triage_level,
            "written":     list(written.keys()),
            "note_preview": note_text[:120] + "…",
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — SETTINGS SCHEMA (for Pulp's office onboarding UI)
# ══════════════════════════════════════════════════════════════════════════════
#
# When a dental office signs up for Pulp, show them this settings form.
# Store the values encrypted in Pulp's database (use AES-256 for API keys).
#
# SETTINGS FORM FIELDS:
# ┌─────────────────────────────────────────────────────────┐
# │ Open Dental Integration                                  │
# │                                                          │
# │ Connection Type:  ○ API (recommended)  ○ MySQL (legacy) │
# │                                                          │
# │ [API mode]                                               │
# │  Server URL:  [http://192.168.1.50:8040         ]        │
# │  API Key:     [••••••••••••••••••••••••••••••••]        │
# │  [ Test Connection ]                                     │
# │                                                          │
# │ [MySQL mode]                                             │
# │  Host:        [192.168.1.50                    ]        │
# │  Port:        [3306]                                     │
# │  Database:    [opendental                      ]        │
# │  Username:    [pulp_user                       ]        │
# │  Password:    [••••••••••••••••]                        │
# │  [ Test Connection ]                                     │
# │                                                          │
# │ Write-back options:                                      │
# │  ☑ Write AI note to chart                               │
# │  ☑ Update annual maximum remaining                      │
# │  ☑ Update deductible met                                │
# │  ☑ Set triage color flag                                │
# └─────────────────────────────────────────────────────────┘


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — DEMO
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import asyncio

    # Simulated SmartBreakdown output from pulp_fallback_manager.py
    SAMPLE_BREAKDOWN = {
        "patient_id": "p1",
        "carrier":    "Delta Dental PPO",
        "member_id":  "DD00112233",
        "completeness_grade": "B",
        "fields": {
            "annual_maximum":           200000,
            "annual_maximum_remaining": 145000,
            "individual_deductible":    5000,
            "deductible_met":           5000,
            "coverage_pct.basic":       80,
            "coverage_pct.major":       50,
        },
        "warnings": [],
    }

    async def demo():
        print("\n" + "═"*55)
        print("  OPEN DENTAL INTEGRATION — Demo")
        print("═"*55)

        # ── Demo 1: API mode ──────────────────────────────────────────────
        print("\n▶ API Mode (v21.1+)")
        api_config = OpenDentalConfig(
            mode=ConnectionMode.API,
            office_id="office_001",
            api_key="your-open-dental-api-key-here",
            server_url="http://192.168.1.50:8040",
        )
        client = OpenDentalClient(api_config)
        result = await client.write_verification(
            od_pat_num=1234,
            breakdown=SAMPLE_BREAKDOWN,
            triage_level="CLEAR",
            triage_warnings=[],
        )
        print(f"  Written: {result['written']}")
        print(f"  Note preview: {result['note_preview']}")

        # ── Demo 2: MySQL mode ────────────────────────────────────────────
        print("\n▶ MySQL Mode (legacy)")
        mysql_config = OpenDentalConfig(
            mode=ConnectionMode.MYSQL,
            office_id="office_002",
            mysql_host="192.168.1.50",
            mysql_port=3306,
            mysql_database="opendental",
            mysql_user="pulp_user",
            mysql_password="securepassword",
        )
        client2 = OpenDentalClient(mysql_config)
        result2 = await client2.write_verification(
            od_pat_num=5678,
            breakdown=SAMPLE_BREAKDOWN,
            triage_level="WARNING",
            triage_warnings=["Deductible not fully met", "Crown waiting period active"],
        )
        print(f"  Written: {result2['written']}")

        # ── Demo 3: Format chart note ─────────────────────────────────────
        print("\n▶ Sample Chart Note (what appears in Open Dental):")
        print("─"*55)
        note = format_chart_note(SAMPLE_BREAKDOWN, "WARNING", ["Deductible not met"])
        print(note)
        print("─"*55)

    asyncio.run(demo())
