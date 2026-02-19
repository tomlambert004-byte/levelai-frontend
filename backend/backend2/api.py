# =============================================================================
# api.py — FastAPI Pre-Authorization Endpoint
# =============================================================================
# This is the entry point for the pre-authorization feature.
# It is intentionally thin — its only jobs are:
#   1. Validate the incoming request
#   2. Create a DB record (so there's a persistent ID before work begins)
#   3. Hand off to Celery and return 202 immediately
#
# The 202 Accepted pattern is critical here. Pre-auth processing takes
# 10-30+ seconds (LLM call + payer API/RPA submission). If we did all of
# that synchronously inside FastAPI, the HTTP connection would time out
# and the frontend would show an error even though the work succeeded.
#
# DATA FLOW:
#   POST /api/preauth/submit (this file)
#     → creates PreAuthorization row  [models.py]
#       → kicks off Celery task        [worker.py]
#         → calls Claude API           [clinical_scribe.py]
#           → updates DB row to SUBMITTED
#
#   GET /api/preauth/{id}/status
#     → returns current row status (PENDING → PROCESSING → SUBMITTED/FAILED)
# =============================================================================

import uuid
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
import os

from models import Base, PreAuthorization, PreAuthStatus
# Import the Celery task — we only call .delay() here, never run it directly
from worker import process_preauth

logger = logging.getLogger(__name__)


# =============================================================================
# 1. DATABASE SETUP (FastAPI side)
# =============================================================================
# This is the FastAPI app's own DB connection pool — separate from the
# Celery worker's pool in worker.py. Both point to the same Postgres DB.

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/level_ai"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Create all tables on startup if they don't exist.
    In production, use Alembic migrations instead of create_all().
    """
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables verified/created.")
    yield
    # Cleanup on shutdown (close connection pool, etc.) would go here


# =============================================================================
# 2. FASTAPI APPLICATION
# =============================================================================

app = FastAPI(
    title="Level AI — Pre-Authorization Service",
    description="Async pre-auth submission backed by Celery + Claude AI",
    version="1.0.0",
    lifespan=lifespan,
)


# =============================================================================
# 3. DEPENDENCY: DB Session per Request
# =============================================================================

def get_db() -> Session:
    """
    FastAPI dependency that provides a SQLAlchemy session for the duration
    of a single request. The session is automatically closed when the
    request finishes (even if it raised an exception).

    Usage:
        @app.post("/some-endpoint")
        def my_endpoint(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =============================================================================
# 4. PYDANTIC SCHEMAS (Request / Response shapes)
# =============================================================================

class PreAuthSubmitRequest(BaseModel):
    """
    JSON body expected by POST /api/preauth/submit.

    patient_id:     ID of the patient in your PMS/EHR.
    procedure_code: CDT procedure code to pre-authorize (e.g. "D6010").
    """
    patient_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        examples=["p_dem4"],
        description="Patient ID from the PMS/EHR (maps to hoursUntil patient list in frontend)"
    )
    procedure_code: str = Field(
        ...,
        min_length=3,
        max_length=16,
        examples=["D6010"],
        description="CDT or CPT code for the procedure requiring pre-authorization"
    )


class PreAuthSubmitResponse(BaseModel):
    """
    202 Accepted response returned immediately after task is queued.

    The frontend stores `preauth_id` and uses it to poll
    GET /api/preauth/{preauth_id}/status for live progress updates.
    """
    preauth_id: str = Field(description="UUID of the PreAuthorization record")
    status: str     = Field(description="Always 'PENDING' at submission time")
    message: str    = Field(description="Human-readable confirmation")


class PreAuthStatusResponse(BaseModel):
    """
    Response for GET /api/preauth/{preauth_id}/status.
    """
    preauth_id:        str
    patient_id:        str
    procedure_code:    str
    status:            str
    submission_method: str | None
    ai_narrative:      str | None
    created_at:        datetime
    updated_at:        datetime


# =============================================================================
# 5. API ENDPOINTS
# =============================================================================

@app.post(
    "/api/preauth/submit",
    response_model=PreAuthSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a pre-authorization request",
    description=(
        "Creates a PreAuthorization record in the database and immediately "
        "queues a background Celery task to process it. Returns 202 Accepted "
        "with the preauth_id before any AI processing begins."
    ),
)
def submit_preauth(
    payload: PreAuthSubmitRequest,
    db: Session = Depends(get_db),
) -> PreAuthSubmitResponse:
    """
    The full lifecycle for a single HTTP request to this endpoint:

    1.  FastAPI validates `payload` against PreAuthSubmitRequest (Pydantic).
        If validation fails, FastAPI auto-returns a 422 Unprocessable Entity.

    2.  We create a PreAuthorization row in Postgres with status=PENDING.
        This is synchronous and fast (single INSERT).

    3.  We call process_preauth.delay() to push the task to Redis.
        .delay() returns immediately — it does NOT wait for the task to run.
        The Celery worker process picks it up asynchronously.

    4.  We return 202 Accepted with the preauth_id.
        The whole endpoint runs in < 100ms regardless of how long processing takes.
    """

    # -------------------------------------------------------------------------
    # Step 1: Create the database record
    # We generate the UUID in Python so we can return it before the DB commit.
    # (If we let the DB generate it, we'd have to do an extra SELECT after INSERT)
    # -------------------------------------------------------------------------
    preauth_id = str(uuid.uuid4())

    new_preauth = PreAuthorization(
        id=preauth_id,
        patient_id=payload.patient_id,
        procedure_code=payload.procedure_code,
        status=PreAuthStatus.PENDING,   # default; worker will update this
        ai_narrative=None,              # populated by worker Step C
        submission_method=None,         # populated by worker Step D
    )

    db.add(new_preauth)

    try:
        db.commit()
        logger.info(
            "PreAuthorization record created | id=%s patient=%s code=%s",
            preauth_id, payload.patient_id, payload.procedure_code
        )
    except Exception as e:
        db.rollback()
        logger.exception("Failed to create PreAuthorization record: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create pre-authorization record in database.",
        )

    # -------------------------------------------------------------------------
    # Step 2: Enqueue the Celery background task
    #
    # .delay() is shorthand for .apply_async() with no special options.
    # It serializes the arguments to JSON and pushes a message to Redis.
    # The Celery worker (running as a separate process) picks it up and calls
    # process_preauth(preauth_id, patient_id, procedure_code).
    #
    # KEY INSIGHT: This line returns instantly. We are NOT waiting for the
    # task to finish. The worker might not even start running it until after
    # this HTTP response has already been sent to the client.
    # -------------------------------------------------------------------------
    task = process_preauth.delay(
        preauth_id=preauth_id,
        patient_id=payload.patient_id,
        procedure_code=payload.procedure_code,
    )

    logger.info(
        "Celery task queued | task_id=%s preauth_id=%s",
        task.id, preauth_id
    )

    # -------------------------------------------------------------------------
    # Step 3: Return 202 Accepted immediately
    # The frontend can now poll /api/preauth/{preauth_id}/status
    # to watch the status go: PENDING → PROCESSING → SUBMITTED
    # -------------------------------------------------------------------------
    return PreAuthSubmitResponse(
        preauth_id=preauth_id,
        status=PreAuthStatus.PENDING.value,
        message=(
            f"Pre-authorization request queued successfully. "
            f"Poll /api/preauth/{preauth_id}/status for updates."
        ),
    )


@app.get(
    "/api/preauth/{preauth_id}/status",
    response_model=PreAuthStatusResponse,
    summary="Poll pre-authorization status",
    description=(
        "Returns the current status of a pre-authorization request. "
        "The frontend should poll this endpoint every 3-5 seconds after "
        "receiving a 202 from /api/preauth/submit."
    ),
)
def get_preauth_status(
    preauth_id: str,
    db: Session = Depends(get_db),
) -> PreAuthStatusResponse:
    """
    Simple read-only status check.

    The Celery worker updates the DB record as it progresses through each step,
    so this endpoint just reads the current state of the row.
    """
    preauth = db.get(PreAuthorization, preauth_id)

    if not preauth:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No pre-authorization found with id={preauth_id}",
        )

    return PreAuthStatusResponse(
        preauth_id=str(preauth.id),
        patient_id=preauth.patient_id,
        procedure_code=preauth.procedure_code,
        status=preauth.status.value,
        submission_method=preauth.submission_method.value if preauth.submission_method else None,
        # Only return the first 500 chars of the narrative in the status poll.
        # The full narrative can be fetched via a dedicated GET /api/preauth/{id}/narrative endpoint.
        ai_narrative=preauth.ai_narrative[:500] + "..." if preauth.ai_narrative and len(preauth.ai_narrative) > 500 else preauth.ai_narrative,
        created_at=preauth.created_at,
        updated_at=preauth.updated_at,
    )


# =============================================================================
# 6. DEV ENTRYPOINT
# =============================================================================
# Run with: uvicorn api:app --reload --port 8000
# Then test with:
#   curl -X POST http://localhost:8000/api/preauth/submit \
#     -H "Content-Type: application/json" \
#     -d '{"patient_id": "p_dem4", "procedure_code": "D6010"}'
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
