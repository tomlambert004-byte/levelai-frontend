-- AddUniqueConstraint: Patient(practiceId, externalId)
-- Allows upsert by Open Dental appointment number per practice
-- Only applies when externalId is non-null (partial index)

CREATE UNIQUE INDEX IF NOT EXISTS "Patient_practiceId_externalId_key"
  ON "Patient"("practiceId", "externalId")
  WHERE "externalId" IS NOT NULL;
