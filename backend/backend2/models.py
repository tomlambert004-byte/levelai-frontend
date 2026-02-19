# =============================================================================
# models.py — SQLAlchemy Database Models
# =============================================================================
# This file defines the database schema for the Pre-Authorization feature.
# SQLAlchemy maps these Python classes to actual database tables.
#
# DATA FLOW CONTEXT:
#   API endpoint creates a PreAuthorization row (status=PENDING)
#     → Celery worker picks it up and processes it
#       → Worker updates the same row (status=SUBMITTED, ai_narrative=<text>)
# =============================================================================

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Text, DateTime, Enum as SAEnum, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase


# ---------------------------------------------------------------------------
# Base class — all models inherit from this so SQLAlchemy knows about them
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Enums — using Python enums keeps the allowed values explicit and type-safe.
# SQLAlchemy will enforce these values at the DB constraint level.
# ---------------------------------------------------------------------------

class PreAuthStatus(str, enum.Enum):
    """
    Lifecycle of a pre-authorization request:
      PENDING   → record created, Celery task queued but not started yet
      PROCESSING→ Celery task has picked it up and is running
      SUBMITTED → AI narrative generated and mock-submitted to payer
      FAILED    → something went wrong in the worker (see ai_narrative for error)
    """
    PENDING    = "PENDING"
    PROCESSING = "PROCESSING"
    SUBMITTED  = "SUBMITTED"
    FAILED     = "FAILED"


class SubmissionMethod(str, enum.Enum):
    """
    How the pre-auth was (or will be) submitted to the insurance payer.
      API → direct clearinghouse/payer API call (fast, preferred)
      RPA → browser-based robotic process automation (fallback for portals
            that don't have a public API, e.g. United, Cigna portals)
    """
    API = "API"
    RPA = "RPA"


# ---------------------------------------------------------------------------
# PreAuthorization Model
# ---------------------------------------------------------------------------

class PreAuthorization(Base):
    """
    One row per pre-authorization request.

    The frontend kicks this off by POST-ing to /api/preauth/submit.
    The API immediately returns the `id` field so the frontend can poll
    GET /api/preauth/{id}/status to show a live progress indicator.
    """

    __tablename__ = "pre_authorizations"

    # ------------------------------------------------------------------
    # Primary Key
    # Using UUID instead of an auto-incrementing integer so that:
    #   1. IDs can be generated in Python before the DB round-trip
    #   2. IDs are safe to expose in URLs (not enumerable by attackers)
    # ------------------------------------------------------------------
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,   # auto-generate on Python side
        nullable=False,
        comment="Unique ID returned to the frontend immediately on creation"
    )

    # ------------------------------------------------------------------
    # Business Fields
    # ------------------------------------------------------------------
    patient_id = Column(
        String(64),
        nullable=False,
        index=True,            # we'll frequently query by patient
        comment="Foreign key to the patient record in the PMS/EHR"
    )

    procedure_code = Column(
        String(16),
        nullable=False,
        comment="CDT or CPT procedure code, e.g. D6010 (implant), D2740 (crown)"
    )

    # Status starts as PENDING and is updated by the Celery worker.
    # SAEnum stores the string value in the DB column.
    status = Column(
        SAEnum(PreAuthStatus, name="preauth_status_enum"),
        nullable=False,
        default=PreAuthStatus.PENDING,
        comment="Current lifecycle stage of this pre-auth request"
    )

    # The AI-generated Letter of Medical Necessity.
    # NULL until the Celery worker completes Step C (clinical_scribe).
    ai_narrative = Column(
        Text,
        nullable=True,
        comment="LLM-generated Letter of Medical Necessity — populated by worker"
    )

    # Which submission pathway was used.
    # NULL until the worker decides (API first, RPA fallback).
    submission_method = Column(
        SAEnum(SubmissionMethod, name="submission_method_enum"),
        nullable=True,
        comment="API for direct payer calls, RPA for portal-based submission"
    )

    # ------------------------------------------------------------------
    # Audit Timestamps
    # server_default=func.now() means the DB itself sets the value,
    # so it works even if a record is inserted outside of SQLAlchemy.
    # onupdate=func.now() auto-bumps updated_at on every UPDATE.
    # ------------------------------------------------------------------
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="UTC timestamp when the pre-auth request was first received"
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="UTC timestamp of the last status change (updated by Celery worker)"
    )

    # ------------------------------------------------------------------
    # Helper: readable representation for logging / debugging
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"<PreAuthorization id={self.id} "
            f"patient={self.patient_id} "
            f"code={self.procedure_code} "
            f"status={self.status}>"
        )
