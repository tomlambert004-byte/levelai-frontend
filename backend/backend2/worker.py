# =============================================================================
# worker.py — Celery Background Task Worker
# =============================================================================
# This is where the heavy lifting happens. FastAPI hands off work here
# immediately after creating the DB record, so the HTTP request can return
# a 202 in milliseconds while this runs in the background.
#
# DATA FLOW OVERVIEW:
#
#   [FastAPI /api/preauth/submit]
#       │
#       ├─ 1. Creates PreAuthorization row (status=PENDING) in Postgres
#       │
#       └─ 2. Calls process_preauth.delay(id, patient_id, code)
#                │
#                │  (task is serialized to JSON and pushed to Redis queue)
#                │
#                ▼
#   [Celery Worker Process — runs separately from FastAPI]
#       │
#       ├─ Step A: Fetch PreAuthorization from DB, mark PROCESSING
#       ├─ Step B: Pull raw clinical notes from PMS (mocked here)
#       ├─ Step C: Call clinical_scribe.py → Claude API → formal narrative
#       ├─ Step D: Mock submission delay, mark SUBMITTED, save narrative
#       └─ On any exception: mark FAILED, log the error
#
# HOW TO RUN THE WORKER:
#   celery -A worker.celery_app worker --loglevel=info
#
# HOW TO RUN REDIS LOCALLY (Docker):
#   docker run -d -p 6379:6379 redis:alpine
# =============================================================================

import os
import time
import logging
from datetime import datetime, timezone

from celery import Celery
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Our own modules
from models import PreAuthorization, PreAuthStatus, SubmissionMethod
from clinical_scribe import generate_medical_necessity_letter

logger = logging.getLogger(__name__)


# =============================================================================
# 1. CELERY APPLICATION SETUP
# =============================================================================
# broker_url  → where Celery reads tasks FROM (Redis acts as the message queue)
# backend_url → where Celery writes task results TO (also Redis here)
#
# In production, set REDIS_URL as an environment variable (e.g. from Railway,
# Render, or AWS ElastiCache). Falls back to localhost for local development.
# =============================================================================

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "level_ai_worker",       # internal name for this Celery application
    broker=REDIS_URL,        # Redis as the message broker (task queue)
    backend=REDIS_URL,       # Redis also stores task state/results
)

# Celery configuration
celery_app.conf.update(
    # Use JSON serialization — safer and debuggable vs pickle
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # Automatically acknowledge the task only after it completes successfully.
    # If the worker crashes mid-task, Redis will re-queue it.
    task_acks_late=True,

    # Retry on connection errors (transient Redis blips)
    broker_connection_retry_on_startup=True,

    # Timezone for scheduled tasks (if you add beat scheduling later)
    timezone="UTC",
)


# =============================================================================
# 2. DATABASE SESSION FACTORY
# =============================================================================
# The Celery worker is a SEPARATE PROCESS from FastAPI, so it needs its own
# DB connection pool. We do NOT share the FastAPI app's engine or session.
#
# DATABASE_URL should be the same Postgres URL your FastAPI app uses.
# Example: postgresql://user:password@localhost:5432/level_ai
# =============================================================================

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/level_ai"
)

# create_engine is thread-safe; sessionmaker gives us factory functions
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db_session():
    """
    Context-manager helper for safe DB session lifecycle inside Celery tasks.
    Always call this with `with get_db_session() as db:` to ensure the session
    is closed even if an exception is raised mid-task.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# =============================================================================
# 3. THE CORE CELERY TASK
# =============================================================================

@celery_app.task(
    name="preauth.process_preauth",   # explicit task name (stable across refactors)
    bind=True,                         # gives us `self` for retries
    max_retries=3,                     # retry up to 3 times on transient failures
    default_retry_delay=60,            # wait 60 seconds between retries
)
def process_preauth(
    self,
    preauth_id: str,
    patient_id: str,
    procedure_code: str,
) -> dict:
    """
    End-to-end background processing of a single pre-authorization request.

    Args:
        self:           Celery task instance (available because bind=True)
        preauth_id:     UUID string of the PreAuthorization DB record to process
        patient_id:     Used to fetch clinical data from the PMS (mocked here)
        procedure_code: CDT code for the procedure (e.g. "D6010")

    Returns:
        A dict summary of what happened — stored in Redis as the task result.
        Useful for debugging and for a future /api/preauth/{id}/status endpoint.
    """

    logger.info(
        "process_preauth STARTED | preauth_id=%s patient_id=%s code=%s",
        preauth_id, patient_id, procedure_code
    )

    try:
        with SessionLocal() as db:
            # -----------------------------------------------------------------
            # STEP A: Fetch the PreAuthorization record from the database
            #         and immediately mark it as PROCESSING.
            #
            # Why mark PROCESSING right away?
            #   - Prevents duplicate workers from picking up the same task
            #   - Allows the frontend to show a live "AI is working..." state
            #     by polling GET /api/preauth/{id}/status
            # -----------------------------------------------------------------
            logger.info("Step A: Fetching PreAuthorization record from DB...")

            preauth = db.get(PreAuthorization, preauth_id)

            if not preauth:
                # This should never happen in normal operation, but if the DB
                # record was deleted between task creation and execution,
                # we bail out cleanly rather than crashing.
                logger.error(
                    "PreAuthorization record NOT FOUND for id=%s. "
                    "Was it deleted? Aborting task.",
                    preauth_id
                )
                return {"error": "record_not_found", "preauth_id": preauth_id}

            # Update status to PROCESSING so the frontend can show progress
            preauth.status = PreAuthStatus.PROCESSING
            db.commit()

            logger.info("Step A complete: status set to PROCESSING")

            # -----------------------------------------------------------------
            # STEP B: Fetch raw clinical notes from the PMS (Practice Mgmt System)
            #
            # In production this would be a real API call to your PMS/EHR:
            #   notes = pms_client.get_clinical_notes(patient_id, procedure_code)
            #
            # For now we generate realistic mock notes based on the procedure
            # code so the LLM has meaningful content to work with.
            # -----------------------------------------------------------------
            logger.info(
                "Step B: Generating mock PMS clinical notes for patient=%s...",
                patient_id
            )

            raw_notes = _fetch_mock_pms_notes(patient_id, procedure_code)

            logger.info(
                "Step B complete: got %d chars of clinical notes", len(raw_notes)
            )

            # -----------------------------------------------------------------
            # STEP C: Call the AI Clinical Scribe to generate the formal
            #         Letter of Medical Necessity.
            #
            # This is the only network call in the worker (to Anthropic's API).
            # If it fails, we let the exception bubble up to the retry logic.
            # -----------------------------------------------------------------
            logger.info(
                "Step C: Calling Claude API via clinical_scribe.py..."
            )

            ai_narrative = generate_medical_necessity_letter(
                raw_notes=raw_notes,
                procedure_code=procedure_code,
            )

            logger.info(
                "Step C complete: narrative generated (%d chars)", len(ai_narrative)
            )

            # -----------------------------------------------------------------
            # STEP D: Simulate the submission delay, then finalize the record.
            #
            # In production, this is where you would:
            #   A) Try the payer's direct API (e.g. Availity, Change Healthcare)
            #   B) If API fails → trigger RPA to submit via the payer's web portal
            #
            # For now we sleep 3 seconds to simulate the network round-trip.
            # -----------------------------------------------------------------
            logger.info(
                "Step D: Simulating payer submission delay (3s)..."
            )
            time.sleep(3)

            # Determine submission method.
            # Real logic: try API first, fall back to RPA.
            # Mock: always use API for simplicity.
            submission_method = SubmissionMethod.API

            # Update the DB record with the completed data
            preauth.status          = PreAuthStatus.SUBMITTED
            preauth.ai_narrative    = ai_narrative
            preauth.submission_method = submission_method
            preauth.updated_at      = datetime.now(timezone.utc)
            db.commit()

            logger.info(
                "Step D complete: PreAuthorization SUBMITTED | "
                "method=%s preauth_id=%s",
                submission_method.value,
                preauth_id,
            )

        # Return a result dict — stored in Redis for debugging / polling
        return {
            "status":            "SUBMITTED",
            "preauth_id":        preauth_id,
            "patient_id":        patient_id,
            "procedure_code":    procedure_code,
            "submission_method": "API",
            "narrative_length":  len(ai_narrative),
        }

    except Exception as exc:
        # ---------------------------------------------------------------------
        # ERROR HANDLING
        # If anything goes wrong (DB down, Claude API error, etc.):
        #   1. Mark the record as FAILED so the frontend shows an error state
        #   2. Ask Celery to retry the task (up to max_retries times)
        #
        # Note: we use a separate DB session here because the one inside the
        # `with` block above may have already been rolled back / closed.
        # ---------------------------------------------------------------------
        logger.exception(
            "process_preauth FAILED | preauth_id=%s error=%s",
            preauth_id, str(exc)
        )

        try:
            fail_db = SessionLocal()
            preauth = fail_db.get(PreAuthorization, preauth_id)
            if preauth:
                preauth.status       = PreAuthStatus.FAILED
                preauth.ai_narrative = f"Error: {str(exc)}"
                fail_db.commit()
            fail_db.close()
        except Exception as db_err:
            logger.error("Could not mark record as FAILED: %s", db_err)

        # Raise the exception to trigger Celery's retry mechanism.
        # On the final retry, Celery marks the task as FAILURE in Redis.
        raise self.retry(exc=exc)


# =============================================================================
# 4. MOCK PMS DATA HELPER
# =============================================================================

def _fetch_mock_pms_notes(patient_id: str, procedure_code: str) -> str:
    """
    Simulate fetching raw clinical notes from a Practice Management System.

    In production, replace this with a real PMS API call:
        response = requests.get(f"{PMS_BASE_URL}/patients/{patient_id}/notes")
        return response.json()["clinical_notes"]

    The notes are deliberately unstructured/messy — that's realistic.
    The AI's job is to turn this into clean, formal prose.
    """
    # Map common CDT codes to realistic note templates
    notes_by_code = {
        "D6010": (
            f"Pt ID {patient_id}. Tooth #14 non-restorable, extensive mesio-occlusal "
            "decay into furcation. Extracted approx 6 months ago by Dr. Patel. "
            "Bone graft placed at time of extraction. CBCT shows adequate ridge "
            "height (9.2mm) and width (7.1mm) for standard 4.0mm implant. "
            "Full perio eval: BOP 18%, avg probing 2.8mm, no mobility. "
            "Patient is non-smoker, no uncontrolled diabetes. "
            "Treatment plan: implant body placement D6010, abutment D6057, "
            "PFM crown D6065. Pre-auth required per Cigna plan."
        ),
        "D7240": (
            f"Pt ID {patient_id}. Impacted #17 (horizontal, class III angulation). "
            "Pano shows root proximity to IAN canal. Referral to OMS for surgical "
            "extraction. Symptomatic — pt reports recurring pericoronitis x3 "
            "in past 12 months. Antibiotics prescribed x2. CBCT ordered "
            "for surgical planning. Pre-auth required."
        ),
        "D4341": (
            f"Pt ID {patient_id}. Generalized moderate chronic periodontitis. "
            "4-6mm pockets in posterior sextants. BOP 64%. Calculus class III. "
            "Last cleaning 18+ months ago (per pt). Heavy smoker — 1ppd x 10yr. "
            "Full mouth series reveals 2-4mm horizontal bone loss throughout. "
            "Tx: SRP Q1-Q2 today, Q3-Q4 in 2 weeks. Perio re-eval 8 weeks."
        ),
    }

    # Return code-specific notes if we have them, otherwise a generic template
    return notes_by_code.get(
        procedure_code,
        (
            f"Pt ID {patient_id}. Procedure {procedure_code} indicated per "
            "clinical evaluation. Patient presents with documented need for "
            "treatment. All conservative alternatives have been explored and "
            "exhausted. Proceed with pre-authorization request."
        )
    )
